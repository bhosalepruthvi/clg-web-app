const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
process.env.AUTH_RATE_LIMIT_OVERRIDE = '500';
const { app, setQueryExecutor, resetQueryExecutor } = require('./server_studyflow_v2');
const { createLocalStore } = require('./local_dev_store');
let server, base, db;
async function request(url, token, body, method = body ? 'POST' : 'GET') {
  const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json() };
}
const teacher = async () => (await request('/api/auth/teacher/login', null, { email: 'teacher@studyflow.dev', password: 'Teach#2026' })).data.token;
const student = async () => (await request('/api/auth/student/login', null, { access_code: 'FE-E-E1-36', password: 'student123' })).data.token;
test.before(async()=>{server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}`;});
test.beforeEach(()=>{db=createLocalStore();setQueryExecutor(db.executor);});
test.after(()=>{server.close();resetQueryExecutor();});
test('student code alone and incorrect passwords cannot authenticate', async()=>{
  assert.equal((await request('/api/auth/student/login',null,{access_code:'FE-E-E1-36'})).status,401);
  assert.equal((await request('/api/auth/student/login',null,{access_code:'FE-E-E1-36',password:'wrong'})).status,401);
  assert.ok(await student());
});
test('registration code is one-use; recovery revokes old sessions and preserves student record',async()=>{
 const token=await teacher(), old=await student();
 const reset=await request('/api/students/101/reset-password',token,{});assert.equal(reset.status,200);assert.equal(reset.data.initial_password,undefined);
 assert.equal((await request('/api/campus',old)).status,401);
 const credentials={code:reset.data.registration_code,email:'student@example.com',password:'My new secure password!'};
 const registered=await request('/api/auth/student/register',null,credentials);assert.equal(registered.status,201);
 assert.equal((await request('/api/auth/student/register',null,{...credentials,email:'attacker@example.com'})).status,400);
 const login=await request('/api/auth/student/login',null,{email:credentials.email,password:credentials.password});assert.ok(login.data.token);assert.equal(login.data.student.id,101);
 assert.equal(db.state.students.find(s=>s.ID===101).REGISTRATION_CODE,null);
});
test('enrollment issues only a private code and duplicate email cannot claim another record',async()=>{
 const token=await teacher();const enroll=roll=>request('/api/students',token,{name:'New Student',academic_year:'FE',branch:'Common',division:'E',batch:'E1',roll_number:roll});
 const created=await enroll('99');assert.equal(created.status,201);assert.match(created.data.student.registration_code,/^STU-[A-F0-9]{24}$/);assert.equal(created.data.student.initial_password,undefined);
 const credentials={code:created.data.student.registration_code,email:'new@example.com',password:'Secure new password!'};
 assert.equal((await request('/api/auth/student/register',null,{...credentials,code:created.data.student.access_code})).status,400);
 assert.equal((await request('/api/auth/student/register',null,credentials)).status,201);
 const second=await enroll('98');const code=second.data.student.registration_code;
 assert.equal((await request('/api/auth/student/register',null,{...credentials,code})).status,409);
 assert.equal((await request('/api/auth/student/register',null,{...credentials,code,email:'other@example.com'})).status,201);
});
test('timetable scopes divisions, validates times and archives entries',async()=>{
  const t=await teacher(), s=await student();
  assert.equal((await request('/api/campus/timetable',s,{class_id:10,title:'Unauthorized',day:1,start:'09:00',end:'10:00'})).status,403);
  assert.equal((await request('/api/campus/timetable',t,{class_id:10,title:'Bad time',day:1,start:'10:00',end:'09:00'})).status,400);
  const entry=await request('/api/campus/timetable',t,{class_id:10,title:'Maths',day:1,start:'09:00',end:'10:00'});assert.equal(entry.status,201);
  await request('/api/campus/timetable',t,{class_id:30,title:'Private SE class',day:2,start:'09:00',end:'10:00'});
  const view=await request('/api/campus',s);assert.equal(view.data.items.length,1);assert.equal(view.data.items[0].title,'Maths');
  assert.equal((await request(`/api/campus/${entry.data.id}`,t,{archived:true},'PATCH')).status,200);
  assert.equal((await request('/api/campus',s)).data.items[0].archived,true);
});
test('assignments accept and update one own submission, excluding other divisions',async()=>{
  const t=await teacher(), s=await student();
  const due=new Date(Date.now()+86400000).toISOString();
  const entry=await request('/api/campus/assignment',t,{class_id:10,title:'Practice',due,instructions:'Try these problems.'});assert.equal(entry.status,201);
  const privateEntry=await request('/api/campus/assignment',t,{class_id:30,title:'SE only',due});
  assert.equal((await request('/api/campus/submission',s,{class_id:30,assignment_id:privateEntry.data.id,answer:'Wrong class'})).status,403);
  assert.equal((await request('/api/campus/submission',s,{class_id:10,assignment_id:entry.data.id,link:'javascript:alert(1)'})).status,400);
  const first=await request('/api/campus/submission',s,{class_id:10,assignment_id:entry.data.id,answer:'My work'});assert.equal(first.status,201);
  const second=await request('/api/campus/submission',s,{class_id:10,assignment_id:entry.data.id,answer:'Revised work'});assert.equal(second.data.id,first.data.id);
  assert.equal((await request('/api/campus',t)).data.items.filter(i=>i.kind==='submission').length,1);
});
test('correction approval updates a session without duplicate attendance and keeps audit',async()=>{
  const t=await teacher(),s=await student();const count=db.state.attendance.length;
  const correction=await request('/api/campus/correction',s,{class_id:10,date:'2026-10-08',reason:'I was present.'});assert.equal(correction.status,201);
  assert.equal((await request('/api/campus/correction',s,{class_id:10,date:'2026-10-08',reason:'Again'})).status,409);
  assert.equal((await request(`/api/campus/${correction.data.id}`,t,{status:'approved'},'PATCH')).status,200);
  assert.equal(db.state.attendance.length,count);assert.equal(db.state.attendance.find(a=>a.STUDENT_ID===101&&a.CLASS_ID===10&&a.ATTENDANCE_DATE==='2026-10-08').STATUS,'present');
  const item=(await request('/api/campus',s)).data.items[0];assert.equal(item.status,'approved');assert.ok(item.reviewed_at);
});
test('persistent local development store survives recreation',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'studyflow-persistence-'));const file=path.join(directory,'data.json');
  try {const first=createLocalStore({file});await first.executor('INSERT INTO campus_items (kind, owner_id, class_id, payload) VALUES (:kind, :owner_id, :class_id, :payload)',{kind:'timetable',owner_id:1,class_id:10,payload:'{"title":"Survives restart"}'});const second=createLocalStore({file});assert.equal(second.state.campus[0].PAYLOAD,'{"title":"Survives restart"}');}finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('division discussions enforce membership, ownership, reports and moderation', async()=>{
  const s=await student(), t=await teacher();
  const other=(await request('/api/auth/student/login',null,{access_code:'SE-CE-A-A1-12',password:'student123'})).data.token;
  assert.ok(other);
  assert.equal((await request('/api/discussions')).status,401);
  const post=await request('/api/discussions',s,{title:'Revision group',body:'Discuss chapter one',category:'Study doubts',scope:'SE|CE|A'});
  assert.equal(post.status,201);
  const id=post.data.id;
  assert.equal((await request('/api/discussions',other)).data.items.length,0);
  assert.equal((await request(`/api/discussions/${id}/reply`,other,{body:'Unauthorized'})).status,404);
  assert.equal((await request(`/api/discussions/${id}`,other,{},'DELETE')).status,404);
  assert.equal((await request('/api/discussions',s)).data.items[0].scope,'FE|COMMON|E');
  assert.equal((await request('/api/discussions',s,{title:' ',body:'x',category:'General'})).status,400);
  assert.equal((await request('/api/discussions',t,{title:'x',body:'x',category:'General'})).status,403);
  const peer=db.state.students.find(x=>x.ID===102); Object.assign(peer,{ACADEMIC_YEAR:'FE',BRANCH:'Common',DIVISION:'E'});
  assert.equal((await request(`/api/discussions/${id}`,other,{title:'Stolen',body:'Changed'},'PATCH')).status,403);
  const reply=await request(`/api/discussions/${id}/reply`,other,{body:'Can we start at five?'}); assert.equal(reply.status,201);
  assert.equal((await request(`/api/discussions/${id}/report`,other,{reason:'Please review'})).status,201);
  assert.equal((await request(`/api/discussions/${id}/report`,other,{reason:'Again'})).status,409);
  assert.equal((await request('/api/discussions',s)).data.items.some(i=>i.kind==='report'),false);
  assert.equal((await request('/api/discussions',t)).data.items.some(i=>i.kind==='report'),true);
  assert.equal((await request(`/api/discussions/${id}`,s,{title:'Updated title',body:'Updated message'},'PATCH')).status,200);
  assert.equal((await request(`/api/discussions/${id}`,t,{},'DELETE')).status,200);
  assert.equal((await request(`/api/discussions/${id}/reply`,s,{body:'After deletion'})).status,404);
  const deleted=(await request('/api/discussions',s)).data.items.find(i=>i.id===id); assert.equal(deleted.body,''); assert.equal(deleted.deleted,true);
  assert.equal((await request('/api/campus',s)).data.items.length,0);
  peer.BRANCH='CE'; assert.equal((await request('/api/discussions',other)).data.items.length,0);
  peer.BRANCH='Common'; peer.ACADEMIC_YEAR='SE'; assert.equal((await request('/api/discussions',other)).data.items.length,0);
  peer.ACADEMIC_YEAR='FE'; peer.DIVISION='F'; assert.equal((await request('/api/discussions',other)).data.items.length,0);
  db.state.classes.forEach(c=>{ if(c.TEACHER_ID===1)c.DIVISION='Z'; });
  assert.equal((await request('/api/discussions',t)).data.items.length,0);
  assert.equal((await request(`/api/discussions/${reply.data.id}`,t,{},'DELETE')).status,404);
});



test('teacher password change requires current password and revokes old sessions',async()=>{
 const token=await teacher();
 assert.equal((await request('/api/account/change-password',token,{current_password:'wrong',new_password:'ChangedPass123!'})).status,400);
 assert.equal((await request('/api/account/change-password',token,{current_password:'Teach#2026',new_password:'ChangedPass123!'})).status,200);
 assert.equal((await request('/api/access',token)).status,401);
 assert.equal((await request('/api/auth/teacher/login',null,{email:'teacher@studyflow.dev',password:'Teach#2026'})).status,401);
 const updated=await request('/api/auth/teacher/login',null,{email:'teacher@studyflow.dev',password:'ChangedPass123!'});
 assert.ok(updated.data.token);assert.equal((await request('/api/access',updated.data.token)).status,200);
});
test('student can change password and old token stops working',async()=>{
 const token=await student();
 assert.equal((await request('/api/account/change-password',token,{current_password:'student123',new_password:'StudentNew123!'})).status,200);
 assert.equal((await request('/api/campus',token)).status,401);
 const updated=await request('/api/auth/student/login',null,{access_code:'FE-E-E1-36',password:'StudentNew123!'});
 assert.ok(updated.data.token);
});
test('faculty password recovery requires administrator and revokes sessions',async()=>{
 const token=await teacher();const jwt=require('jsonwebtoken'); const id=jwt.decode(token).id;
 const other=db.state.teachers.find(t=>Number(t.ID)!==Number(id));assert.ok(other);
 const old=await request('/api/auth/teacher/login',null,{email:other.EMAIL,password:'teacher123'});assert.ok(old.data.token);
 const previous=process.env.ADMIN_TEACHER_IDS;process.env.ADMIN_TEACHER_IDS='';
 try {
  assert.equal((await request('/api/admin/faculty/'+other.ID+'/reset-password',token,{})).status,403);
  process.env.ADMIN_TEACHER_IDS=String(id);
  const reset=await request('/api/admin/faculty/'+other.ID+'/reset-password',token,{});assert.equal(reset.status,200);assert.ok(reset.data.initial_password);
  assert.equal((await request('/api/access',old.data.token)).status,401);
  assert.ok((await request('/api/auth/teacher/login',null,{email:other.EMAIL,password:reset.data.initial_password})).data.token);
 } finally {if(previous===undefined)delete process.env.ADMIN_TEACHER_IDS;else process.env.ADMIN_TEACHER_IDS=previous;}
});
