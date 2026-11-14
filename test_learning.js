const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'studyflow-learning-'));
process.env.PRIVATE_UPLOADS_DIR=path.join(scratch,'private');process.env.UPLOADS_DIR=path.join(scratch,'uploads');process.env.AUTH_RATE_LIMIT_OVERRIDE='1000';process.env.ADMIN_TEACHER_IDS='1';
const {app,setQueryExecutor,resetQueryExecutor}=require('./server_studyflow_v2');
const {createLocalStore}=require('./local_dev_store');
let server,base,db;
async function request(url,token,body,method=body?'POST':'GET'){
 const r=await fetch(base+url,{method,headers:{...(token?{Authorization:`Bearer ${token}`}:{ }),...(body instanceof FormData?{}:{'Content-Type':'application/json'})},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{})});
 return {status:r.status,data:r.headers.get('content-type')?.includes('application/json')?await r.json():await r.text()};
}
const teacher=async(email='teacher@studyflow.dev',password='Teach#2026')=>(await request('/api/auth/teacher/login',null,{email,password})).data.token;
const student=async(code='FE-E-E1-36')=>(await request('/api/auth/student/login',null,{access_code:code,password:'student123'})).data.token;
const assignment=async(t)=>(await request('/api/campus/assignment',t,{class_id:10,title:'Homework',due:new Date(Date.now()+3600000).toISOString()})).data.id;
const submission=async(s,id)=>(await request('/api/campus/submission',s,{class_id:10,assignment_id:id,answer:'My explanation'})).data.id;
test.before(async()=>{server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}`;});
test.beforeEach(()=>{db=createLocalStore();setQueryExecutor(db.executor);});
test.after(()=>{server.close();resetQueryExecutor();fs.rmSync(scratch,{recursive:true,force:true});});
test('assignment grading validates marks, ownership, stale reviews and revisions',async()=>{
 const t=await teacher(),s=await student(),foreign=await teacher('sharma@college.edu','teacher123');const id=await submission(s,await assignment(t));
 const old=(await request('/api/campus',s)).data.items.find(i=>i.id===id);
 const grade={score:8,maximum:10,feedback:'Good reasoning',submitted_at:old.submitted_at};
 assert.equal((await request(`/api/campus/${id}`,foreign,grade,'PATCH')).status,404);
 assert.equal((await request(`/api/campus/${id}`,s,grade,'PATCH')).status,403);
 assert.equal((await request(`/api/campus/${id}`,t,{...grade,score:11},'PATCH')).status,400);
 assert.equal((await request(`/api/campus/${id}`,t,grade,'PATCH')).status,200);
 assert.equal((await request('/api/campus',s)).data.items.find(i=>i.id===id).grade.score,8);
 assert.ok((await request('/api/notifications',s)).data.items.some(i=>i.title==='Assignment reviewed'));
 await submission(s,old.assignment_id);
 assert.equal((await request('/api/campus',s)).data.items.find(i=>i.id===id).grade,null);
 assert.equal((await request(`/api/campus/${id}`,t,grade,'PATCH')).status,409);
});
test('attachments validate bytes and protect both metadata and downloads',async()=>{
 const t=await teacher(),s=await student(),other=await student('SE-CE-A-A1-12');const id=await submission(s,await assignment(t));
 const form=(body='%PDF-1.4\n%%EOF',mime='application/pdf')=>{const f=new FormData();f.append('file',new Blob([body],{type:mime}),'homework.pdf');return f;};
 assert.equal((await request(`/api/files/submission/${id}`,other,form())).status,404);
 assert.equal((await request(`/api/files/submission/${id}`,s,form('<html>bad</html>'))).status,400);
 const upload=await request(`/api/files/submission/${id}`,s,form());assert.equal(upload.status,201);
 assert.equal((await request(`/api/files/download/${upload.data.id}/content`,t)).status,200);
 assert.equal((await request(`/api/files/download/${upload.data.id}/content`,other)).status,404);
 assert.equal((await request(`/api/files/submission/${id}`,s)).data.files[0].disk,undefined);
 assert.equal((await request(`/api/files/${upload.data.id}`,other,{},'DELETE')).status,404);
 assert.equal((await request(`/api/files/${upload.data.id}`,s,{},'DELETE')).status,200);
 assert.equal((await request(`/api/files/download/${upload.data.id}/content`,s)).status,404);
 const post=(await request('/api/discussions',s,{title:'Notes',body:'Shared notes',category:'General'})).data.id;
 const shared=await request(`/api/files/discussion/${post}`,s,form());assert.equal(shared.status,201);
 assert.equal((await request(`/api/files/download/${shared.data.id}/content`,other)).status,404);
 Object.assign(db.state.students.find(s=>s.ID===102),{ACADEMIC_YEAR:'FE',BRANCH:'Common',DIVISION:'E'});
 assert.equal((await request(`/api/files/download/${shared.data.id}/content`,other)).status,200);
});
test('exam results and quiz answers are protected by class and student ownership',async()=>{
 const t=await teacher(),s=await student(),other=await student('SE-CE-A-A1-12');
 const exam=await request('/api/learning/exam',t,{class_id:10,title:'Unit test',date:'2027-01-20T10:00:00Z',maximum:20});assert.equal(exam.status,201);
 assert.equal((await request(`/api/learning/${exam.data.id}/marks`,t,{student_id:101,score:18})).status,200);
 assert.equal((await request(`/api/learning/${exam.data.id}/marks`,t,{student_id:102,score:18})).status,403);
 assert.equal((await request('/api/learning',other)).data.items.length,0);
 const quiz=(await request('/api/learning/quiz',t,{class_id:10,title:'Revision'})).data.id;
 assert.equal((await request(`/api/learning/${quiz}`,t,{published:true},'PATCH')).status,400);
 const q=(await request(`/api/learning/${quiz}/questions`,t,{prompt:'Two plus two?',options:['1','2','3','4'],answer:3,explanation:'Add two pairs.'})).data.id;
 assert.equal((await request('/api/learning',s)).data.items.some(i=>i.kind==='question'),false);
 await request(`/api/learning/${quiz}`,t,{published:true},'PATCH');
 const question=(await request('/api/learning',s)).data.items.find(i=>i.id===q);assert.equal(question.answer,undefined);assert.equal(question.explanation,undefined);
 assert.equal((await request(`/api/learning/${quiz}/attempt`,other,{answers:{[q]:3}})).status,404);
 assert.equal((await request(`/api/learning/${quiz}/attempt`,s,{answers:{}})).status,400);
 const attempt=await request(`/api/learning/${quiz}/attempt`,s,{answers:{[q]:3}});assert.equal(attempt.data.score,1);assert.equal(attempt.data.review[0].answer,3);
 assert.equal((await request(`/api/learning/${quiz}/questions`,t,{prompt:'Changed'})).status,409);
});
test('admin restrictions, term history and promotion preserve student records',async()=>{
 const t=await teacher(),s=await student(),foreign=await teacher('sharma@college.edu','teacher123');
 assert.equal((await request('/api/admin',foreign)).status,403);assert.equal((await request('/api/admin',s)).status,403);
 assert.equal((await request('/api/admin',t)).data.students[0].PASSWORD_HASH,undefined);
 assert.equal((await request('/api/admin/faculty/2',t,{disabled:true},'PATCH')).status,200);
 assert.equal((await request('/api/classes',foreign)).status,403);
 await request('/api/admin/faculty/2',t,{disabled:false},'PATCH');
 const a=await assignment(t);await submission(s,a);
 const count=db.state.attendance.length;
 assert.equal((await request('/api/admin/archive-term',t,{term:'Current semester',next_term:'Semester 2'})).status,200);
 assert.equal((await request('/api/campus/config',s)).data.term,'Semester 2');
 assert.ok((await request('/api/history',s)).data.items.some(r=>r.type==='attendance'));
 assert.equal(db.state.attendance.length,count);
 assert.equal((await request('/api/campus',s)).data.items.find(i=>i.id===a).archived,true);
 assert.equal((await request('/api/admin/archive-term',t,{term:'Current semester',next_term:'Semester 2'})).status,409);
 const promotion=await request('/api/admin/students/101/promote',t,{academic_year:'SE',branch:'CE',division:'A',batch:'A1',term:'Current semester'});assert.equal(promotion.status,200);assert.equal(promotion.data.access_code,'SE-CE-A-A1-36');
 assert.equal((await request('/api/campus',s)).data.items.some(i=>i.id===a),false);
 assert.ok((await request('/api/history',s)).data.items.length);
});
test('notification feed excludes other divisions and push rejects missing configuration',async()=>{
 const savedPublicKey=process.env.VAPID_PUBLIC_KEY;
 delete process.env.VAPID_PUBLIC_KEY;
 try{
 const t=await teacher(),s=await student(),other=await student('SE-CE-A-A1-12');await assignment(t);
 assert.ok((await request('/api/notifications',s)).data.items.some(n=>n.title==='Assignment due soon'));
 assert.equal((await request('/api/notifications',other)).data.items.some(n=>n.title==='Assignment due soon'),false);
 assert.equal((await request('/api/notifications/subscribe',s,{subscription:{endpoint:'https://127.0.0.1'}})).status,503);
 }finally{if(savedPublicKey===undefined)delete process.env.VAPID_PUBLIC_KEY;else process.env.VAPID_PUBLIC_KEY=savedPublicKey;}
});

test('push validates destinations and worker sends generic notifications once',async()=>{
 const webpush=require('web-push'),keys=webpush.generateVAPIDKeys(),send=webpush.sendNotification;
 const old={pub:process.env.VAPID_PUBLIC_KEY,priv:process.env.VAPID_PRIVATE_KEY,subject:process.env.VAPID_SUBJECT};
 process.env.VAPID_PUBLIC_KEY=keys.publicKey;process.env.VAPID_PRIVATE_KEY=keys.privateKey;process.env.VAPID_SUBJECT='mailto:test@example.com';
 let sent=0;webpush.sendNotification=async(sub,payload)=>{sent++;assert.equal(JSON.parse(payload).body.includes('Homework'),false);};
 try{
  const s=await student(),t=await teacher();const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/test-only',keys:{p256dh:keys.publicKey,auth:Buffer.alloc(16).toString('base64url')}};
  assert.equal((await request('/api/notifications/subscribe',s,{subscription:{...subscription,endpoint:'https://localhost/private'}})).status,400);
  assert.equal((await request('/api/notifications/subscribe',s,{subscription})).status,201);
  await assignment(t);const service=require('./notification_routes').notificationService(db.executor);await service.tick();assert.equal(sent,1);await service.tick();assert.equal(sent,1);
  await request('/api/notifications/unsubscribe',s,{endpoint:subscription.endpoint});assert.equal(db.state.records.some(r=>r.KIND==='push'),false);
 }finally{webpush.sendNotification=send;for(const [name,value] of [['VAPID_PUBLIC_KEY',old.pub],['VAPID_PRIVATE_KEY',old.priv],['VAPID_SUBJECT',old.subject]]){if(value===undefined)delete process.env[name];else process.env[name]=value;}}
});

test('semester archive retains attachment bytes after original removal and resets current attendance',async()=>{
 const t=await teacher(),s=await student();const id=await submission(s,await assignment(t));const form=new FormData();form.append('file',new Blob(['%PDF-1.4\n%%EOF'],{type:'application/pdf'}),'archive-me.pdf');
 const upload=await request(`/api/files/submission/${id}`,s,form);assert.equal(upload.status,201);
 assert.equal((await request('/api/admin/archive-term',t,{term:'Current semester',next_term:'Next term'})).status,200);
 const saved=(await request('/api/history',s)).data.items.find(r=>r.type==='attachment');assert.ok(saved.has_file);assert.equal(saved.disk,undefined);
 const original=db.state.records.find(r=>r.ID===upload.data.id);fs.unlinkSync(path.join(process.env.PRIVATE_UPLOADS_DIR,JSON.parse(original.PAYLOAD).disk));
 const response=await request(`/api/history/${saved.id}/file`,s);assert.equal(response.status,200);assert.equal(response.data,'%PDF-1.4\n%%EOF');
 assert.equal((await request('/api/attendance/student',s)).data.stats.total,0);
});
