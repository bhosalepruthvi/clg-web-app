'use strict';
const { records, route, fail, text, number, scope, isAdmin }=require('./app_records');
module.exports=function learningRoutes({app,authenticateJWT,query}){
 const store=records(query);
 const classesFor=async u=>(await query('SELECT * FROM classes')).rows.filter(c=>u.role==='teacher'?Number(c.TEACHER_ID)===Number(u.id):u.role==='student'&&scope(c)===scope(u));
 const visible=(r,classes)=>classes.some(c=>Number(c.ID)===r.class_id);
 const teacher=u=>{if(u.role!=='teacher')fail(403,'Teacher access required.');};
 app.use('/api/learning',authenticateJWT);
 app.get('/api/learning',route(async(req,res)=>{
  const classes=await classesFor(req.user),all=await store.all();
  const items=all.filter(r=>['exam','mark','quiz','question','attempt','holiday'].includes(r.kind)&&visible(r,classes));
  const published=new Set(items.filter(r=>r.kind==='quiz'&&r.published&&!r.archived).map(r=>r.id));
  res.json({classes,items:items.filter(r=>req.user.role==='teacher'||((!['mark','attempt'].includes(r.kind)||r.student_id===Number(req.user.id))&&(!['quiz','question'].includes(r.kind)||(r.kind==='quiz'?r.published&&!r.archived:published.has(r.quiz_id))))).map(r=>{
   if(req.user.role==='student'&&r.kind==='question'){const {answer,explanation,...safe}=r;return safe;}return r;
  })});
 }));
 app.post('/api/learning/:kind',route(async(req,res)=>{
  teacher(req.user);const kind=req.params.kind;
  if(!['exam','quiz','holiday'].includes(kind))fail(404,'Unknown learning item.');
  const classes=await classesFor(req.user),class_id=Number(req.body.class_id);
  if(!classes.some(c=>Number(c.ID)===class_id))fail(403,'Choose a class assigned to you.');
  const config=(await store.all()).find(r=>r.kind==='config');
  const payload={class_id,title:text(req.body.title),term:config?.term||process.env.ACADEMIC_TERM||'Current semester',archived:false};
  if(kind==='exam'||kind==='holiday'){
   const date=new Date(req.body.date);if(!Number.isFinite(date.getTime()))fail(400,'Choose a valid date and time.');
   payload.date=date.toISOString();payload.details=text(req.body.details,500,true);
   if(kind==='exam'){payload.maximum=number(req.body.maximum,1,1000);payload.room=text(req.body.room,60,true);}
  }else payload.published=false;
  res.status(201).json({id:await store.add(kind,req.user.id,payload)});
 }));
 app.post('/api/learning/:id/questions',route(async(req,res)=>{
  teacher(req.user);const all=await store.all(),classes=await classesFor(req.user);
  const quiz=all.find(r=>r.kind==='quiz'&&r.id===Number(req.params.id)&&visible(r,classes));if(!quiz)fail(404,'Quiz not found.');
  if(quiz.published)fail(409,'Published quizzes cannot be changed. Create a new quiz.');
  if(all.filter(r=>r.kind==='question'&&r.quiz_id===quiz.id).length>=20)fail(400,'A quiz can have up to 20 questions.');
  const options=req.body.options;if(!Array.isArray(options)||options.length!==4)fail(400,'Provide four answer options.');
  const answer=number(req.body.answer,0,3);if(!Number.isInteger(answer))fail(400,'Choose one answer.');
  res.status(201).json({id:await store.add('question',req.user.id,{class_id:quiz.class_id,quiz_id:quiz.id,prompt:text(req.body.prompt,400),options:options.map(o=>text(o,150)),answer,explanation:text(req.body.explanation,400,true)})});
 }));
 app.patch('/api/learning/:id',route(async(req,res)=>{
  teacher(req.user);const all=await store.all(),classes=await classesFor(req.user);
  const item=all.find(r=>['quiz','exam','holiday'].includes(r.kind)&&r.id===Number(req.params.id)&&visible(r,classes));if(!item)fail(404,'Item not found.');
  if(req.body.published===true&&item.kind==='quiz'){
   if(!all.some(r=>r.kind==='question'&&r.quiz_id===item.id))fail(400,'Add at least one question before publishing.');
   await store.update(item,{published:true});
  }else{if(typeof req.body.archived!=='boolean')fail(400,'Choose an archive state.');await store.update(item,{archived:req.body.archived});}
  res.json({success:true});
 }));
 app.get('/api/learning/:id/roster',route(async(req,res)=>{
  teacher(req.user);const classes=await classesFor(req.user),item=(await store.all()).find(r=>r.kind==='exam'&&r.id===Number(req.params.id)&&visible(r,classes));if(!item)fail(404,'Exam not found.');
  const cls=classes.find(c=>Number(c.ID)===item.class_id);
  res.json({students:(await query('SELECT * FROM students')).rows.filter(s=>scope(s)===scope(cls)).map(s=>({id:s.ID,name:s.NAME,roll:s.ROLL_NUMBER}))});
 }));
 app.post('/api/learning/:id/marks',route(async(req,res)=>{
  teacher(req.user);const all=await store.all(),classes=await classesFor(req.user),exam=all.find(r=>r.kind==='exam'&&r.id===Number(req.params.id)&&visible(r,classes));if(!exam||exam.archived)fail(404,'Current exam not found.');
  const student=(await query('SELECT * FROM students WHERE id = :id',[Number(req.body.student_id)])).rows[0];
  if(!student||scope(student)!==scope(classes.find(c=>Number(c.ID)===exam.class_id)))fail(403,'Student is not in this division.');
  const changes={class_id:exam.class_id,exam_id:exam.id,student_id:Number(student.ID),student_name:student.NAME,title:exam.title,term:exam.term,score:number(req.body.score,0,exam.maximum),maximum:exam.maximum,feedback:text(req.body.feedback,400,true),reviewed_at:new Date().toISOString()};
  const old=all.find(r=>r.kind==='mark'&&r.exam_id===exam.id&&r.student_id===Number(student.ID));
  if(old)await store.update(old,changes);else await store.add('mark',req.user.id,changes);
  res.json({success:true});
 }));
 app.post('/api/learning/:id/attempt',route(async(req,res)=>{
  if(req.user.role!=='student')fail(403,'Student access required.');const all=await store.all(),classes=await classesFor(req.user);
  const quiz=all.find(r=>r.kind==='quiz'&&r.id===Number(req.params.id)&&visible(r,classes)&&r.published&&!r.archived);if(!quiz)fail(404,'Quiz not found.');
  const questions=all.filter(r=>r.kind==='question'&&r.quiz_id===quiz.id),answers=req.body.answers;
  if(!answers||typeof answers!=='object'||Array.isArray(answers))fail(400,'Answer every question.');
  const review=questions.map(q=>{const chosen=number(answers[q.id],0,3);if(!Number.isInteger(chosen))fail(400,'Choose one answer for each question.');return {id:q.id,prompt:q.prompt,chosen,answer:q.answer,correct:chosen===q.answer,explanation:q.explanation};});
  const score=review.filter(r=>r.correct).length;
  await store.add('attempt',req.user.id,{class_id:quiz.class_id,quiz_id:quiz.id,student_id:Number(req.user.id),title:quiz.title,score,maximum:questions.length,term:quiz.term});
  res.json({score,maximum:questions.length,review});
 }));
};
