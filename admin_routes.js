'use strict';
const {records,route,fail,text,scope,isAdmin}=require('./app_records');
module.exports=function adminRoutes({app,authenticateJWT,query}){
 const store=records(query);
 app.get('/api/access',authenticateJWT,(req,res)=>res.json({admin:isAdmin(req.user)}));
 app.use('/api/admin',authenticateJWT,(req,res,next)=>isAdmin(req.user)?next():res.status(403).json({error:'Administrator access required.'}));
 app.get('/api/admin',route(async(req,res)=>{
  const all=await store.all();
  res.json({teachers:(await query('SELECT * FROM teachers')).rows.map(t=>({id:t.ID,name:t.NAME,email:t.EMAIL,disabled:all.some(r=>r.kind==='faculty_access'&&r.owner_id===Number(t.ID)&&r.disabled)})),students:(await query('SELECT * FROM students')).rows.map(({PASSWORD_HASH,...s})=>s),classes:(await query('SELECT * FROM classes')).rows,departments:all.filter(r=>r.kind==='department'),term:all.find(r=>r.kind==='config')?.term||process.env.ACADEMIC_TERM||'Current semester'});
 }));
 app.post('/api/admin/departments',route(async(req,res)=>{
  const name=text(req.body.name,60),code=text(req.body.code,10).toUpperCase();
  if(!/^[A-Z0-9]+$/.test(code))fail(400,'Use letters and numbers for department codes.');
  if((await store.all()).some(r=>r.kind==='department'&&r.code===code))fail(409,'Department code already exists.');
  res.status(201).json({id:await store.add('department',req.user.id,{name,code})});
 }));
 app.patch('/api/admin/faculty/:id',route(async(req,res)=>{
  const id=Number(req.params.id);if(id===Number(req.user.id))fail(400,'You cannot disable your own administrator account.');
  if(typeof req.body.disabled!=='boolean')fail(400,'Choose an access state.');
  const exists=(await query('SELECT * FROM teachers')).rows.some(t=>Number(t.ID)===id);if(!exists)fail(404,'Faculty member not found.');
  const old=(await store.all()).find(r=>r.kind==='faculty_access'&&r.owner_id===id);
  const change={disabled:req.body.disabled,reviewed_by:req.user.id,reviewed_at:new Date().toISOString()};
  if(old)await store.update(old,change);else await store.add('faculty_access',id,change);res.json({success:true});
 }));
 app.patch('/api/admin/classes/:id',route(async(req,res)=>{
  const id=Number(req.params.id),teacher_id=Number(req.body.teacher_id);
  if(!(await query('SELECT * FROM classes')).rows.some(c=>Number(c.ID)===id))fail(404,'Class not found.');
  if(!(await query('SELECT * FROM teachers')).rows.some(t=>Number(t.ID)===teacher_id))fail(400,'Choose a faculty member.');
  await query('UPDATE classes SET teacher_id = :teacher_id WHERE id = :id',{id,teacher_id});
  await store.add('audit',req.user.id,{action:'assign_class',class_id:id,teacher_id});res.json({success:true});
 }));
 const snapshot=async(student,term)=>{
  const all=await store.all(),classes=(await query('SELECT * FROM classes')).rows.filter(c=>scope(c)===scope(student)),ids=new Set(classes.map(c=>Number(c.ID)));
  const started=all.find(r=>r.kind==='config')?.term_started_at;
  const inTerm=date=>!started||new Date(date)>=new Date(started);
  const existing=new Set(all.filter(r=>r.kind==='history'&&r.owner_id===Number(student.ID)&&r.term===term).map(r=>r.source));
  const save=async(source,data)=>{if(!existing.has(source)){await store.add('history',Number(student.ID),{term,source,scope:scope(student),...data});existing.add(source);}};
  // Per-row immutable snapshots avoid replacing or deleting any academic data.
  const attendance=(await query('SELECT * FROM attendance WHERE student_id = :student_id',[Number(student.ID)])).rows;
  for(const a of attendance.filter(a=>Number(a.STUDENT_ID)===Number(student.ID)&&ids.has(Number(a.CLASS_ID))&&inTerm(a.ATTENDANCE_DATE)))await save(`attendance:${a.ID||`${a.CLASS_ID}:${a.ATTENDANCE_DATE}`}`,{type:'attendance',title:classes.find(c=>Number(c.ID)===Number(a.CLASS_ID))?.SUBJECT_NAME,date:a.ATTENDANCE_DATE,status:a.STATUS});
  const campus=(await query('SELECT * FROM campus_items')).rows;
  for(const r of campus.filter(r=>r.KIND==='submission'&&Number(r.OWNER_ID)===Number(student.ID)&&ids.has(Number(r.CLASS_ID)))){
   const p=JSON.parse(r.PAYLOAD);if(!inTerm(p.submitted_at))continue;
   const title=JSON.parse(campus.find(a=>Number(a.ID)===p.assignment_id)?.PAYLOAD||'{}').title||'Assignment';
   await save(`submission:${r.ID}`,{type:'assignment',title,grade:p.grade||null,date:p.submitted_at,link:p.link||''});
   const answer=p.answer||'';
   for(let offset=0;offset<answer.length;offset+=600)await save(`submission:${r.ID}:text:${offset}`,{type:'answer',title:`${title} · answer ${Math.floor(offset/600)+1}`,answer:answer.slice(offset,offset+600)});
   const path=require('node:path'),fs=require('node:fs/promises'),root=path.resolve(process.env.PRIVATE_UPLOADS_DIR||path.join(__dirname,'.local-data','private-files'));
   for(const f of all.filter(f=>f.kind==='file'&&f.target_type==='submission'&&f.target_id===Number(r.ID))){
    const source=`submission-file:${f.id}`;if(existing.has(source))continue;
    const disk=require('node:crypto').randomUUID();let available=true;
    try{await fs.copyFile(path.join(root,f.disk),path.join(root,disk));}catch(e){if(e.code!=='ENOENT')throw e;available=false;}
    try{await save(source,{type:'attachment',title:f.name,disk:available?disk:null,mime:f.mime,unavailable:!available});}catch(e){if(available)await fs.unlink(path.join(root,disk)).catch(()=>{});throw e;}
   }
  }
  for(const r of all.filter(r=>['mark','attempt'].includes(r.kind)&&r.student_id===Number(student.ID)&&ids.has(r.class_id)&&inTerm(r.created_at)))await save(`${r.kind}:${r.id}`,{type:r.kind==='mark'?'result':'quiz',title:r.title,score:r.score,maximum:r.maximum,date:r.created_at});
  const materials=(await query('SELECT * FROM study_materials')).rows||[];
  const batches=(await query('SELECT * FROM class_batches')).rows||[];
  for(const m of materials.filter(m=>ids.has(Number(m.CLASS_ID))&&(!m.BATCH_TARGET_ID||batches.some(b=>Number(b.ID)===Number(m.BATCH_TARGET_ID)&&String(b.BATCH_NAME).toUpperCase()===String(student.BATCH).toUpperCase())))){
   const source=`material:${m.ID}`;if(existing.has(source))continue;
   const path=require('node:path'),fs=require('node:fs/promises');
   const root=path.resolve(process.env.UPLOADS_DIR||path.join(__dirname,'uploads'));
   const archiveRoot=path.resolve(process.env.PRIVATE_UPLOADS_DIR||path.join(__dirname,'.local-data','private-files'));
   let disk=null;
   if(m.FILE_URL?.startsWith('/uploads/')){
    const original=path.join(root,path.basename(m.FILE_URL));
    try{await fs.access(original);await fs.mkdir(archiveRoot,{recursive:true});disk=require('node:crypto').randomUUID();await fs.copyFile(original,path.join(archiveRoot,disk));}catch(e){if(e.code!=='ENOENT')throw e;disk=null;}
   }
   try{await save(source,{type:'material',title:m.TITLE,disk,unavailable:!disk});}catch(e){if(disk)await fs.unlink(path.join(archiveRoot,disk)).catch(()=>{});throw e;}
  }
 };
 app.post('/api/admin/archive-term',route(async(req,res)=>{
  const term=text(req.body.term,80),nextTerm=text(req.body.next_term,80);if(term===nextTerm)fail(400,'Choose a different next term.');
  const all=await store.all(),config=all.find(r=>r.kind==='config'),current=config?.term||process.env.ACADEMIC_TERM||'Current semester';
  if(term!==current)fail(409,'The current term changed. Refresh first.');
  for(const s of (await query('SELECT * FROM students')).rows)await snapshot(s,term);
  for(const row of (await query('SELECT * FROM campus_items')).rows.filter(r=>['assignment','timetable'].includes(r.KIND))){const p=JSON.parse(row.PAYLOAD);if(!p.archived)await query('UPDATE campus_items SET payload = :payload WHERE id = :id',{id:Number(row.ID),payload:JSON.stringify({...p,archived:true})});}
  for(const r of all.filter(r=>['exam','quiz','holiday'].includes(r.kind)&&!r.archived))await store.update(r,{archived:true});
  const term_started_at=new Date().toISOString();
  if(config)await store.update(config,{term:nextTerm,term_started_at});else await store.add('config',req.user.id,{term:nextTerm,term_started_at});
  await store.add('audit',req.user.id,{action:'archive_term',term,next_term:nextTerm});res.json({success:true});
 }));
 app.post('/api/admin/students/:id/promote',route(async(req,res)=>{
  const id=Number(req.params.id),student=(await query('SELECT * FROM students WHERE id = :id',[id])).rows[0];if(!student)fail(404,'Student not found.');
  const academic_year=req.body.academic_year,branch=academic_year==='FE'?'Common':text(req.body.branch,30).toUpperCase(),division=text(req.body.division,5).toUpperCase(),batch=text(req.body.batch,10).toUpperCase();
  if(!['FE','SE','TE','BE'].includes(academic_year)||![branch,division,batch].every(s=>/^[A-Za-z0-9]+$/.test(s)))fail(400,'Choose a valid year, branch, division and batch.');
  const access_code=academic_year==='FE'?`${academic_year}-${division}-${batch}-${student.ROLL_NUMBER}`:`${academic_year}-${branch}-${division}-${batch}-${student.ROLL_NUMBER}`;
  if((await query('SELECT * FROM students')).rows.some(s=>s.ID!==id&&s.ACCESS_CODE===access_code))fail(409,'That student code already exists.');
  const term=text(req.body.term,80);await snapshot(student,term);
  await query('UPDATE students SET academic_year = :academic_year, branch = :branch, division = :division, batch = :batch, access_code = :access_code WHERE id = :id',{id,academic_year,branch,division,batch,access_code});
  await store.add('audit',req.user.id,{action:'promote',student_id:id,from:scope(student),to:`${academic_year}|${branch}|${division}`,term});res.json({success:true,access_code});
 }));
 app.get('/api/history',authenticateJWT,route(async(req,res)=>{
  if(req.user.role!=='student')fail(403,'Student access required.');res.json({items:(await store.all()).filter(r=>r.kind==='history'&&r.owner_id===Number(req.user.id)).map(({file_url,disk,...r})=>({...r,has_file:Boolean(disk)}))});
 }));
 app.get('/api/history/:id/file',authenticateJWT,route(async(req,res)=>{
  const r=(await store.all()).find(r=>r.kind==='history'&&['material','attachment'].includes(r.type)&&r.id===Number(req.params.id)&&r.owner_id===Number(req.user.id));
  if(req.user.role!=='student'||!r?.disk)fail(404,'Historical file not found.');
  const path=require('node:path');const root=path.resolve(process.env.PRIVATE_UPLOADS_DIR||path.join(__dirname,'.local-data','private-files'));const filename=path.basename(r.disk);
  res.set({'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Type':r.mime||'application/pdf'});res.download(path.join(root,filename),r.type==='material'?`${r.title}.pdf`:r.title);
 }));
};
