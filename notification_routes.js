'use strict';
const crypto=require('node:crypto');
const {records,route,fail,scope}=require('./app_records');
const fingerprint=s=>crypto.createHash('sha256').update(s).digest('hex').slice(0,20);
function notificationService(query){
 const store=records(query);
 const feed=async user=>{
  const classes=(await query('SELECT * FROM classes')).rows.filter(c=>scope(c)===scope(user)),ids=new Set(classes.map(c=>Number(c.ID)));
  const items=(await query('SELECT * FROM campus_items')).rows.filter(r=>ids.has(Number(r.CLASS_ID))).map(r=>({...JSON.parse(r.PAYLOAD),id:Number(r.ID),kind:r.KIND,owner_id:Number(r.OWNER_ID)}));
  const notes=[];const add=(key,title,body,date,view)=>notes.push({id:fingerprint(key),title,body,date,view});
  for(const i of items){
   if(i.kind==='assignment'&&!i.archived&&(!i.batch||i.batch.toUpperCase()===String(user.batch).toUpperCase())){
    const remaining=Date.parse(i.due)-Date.now();if(remaining>0&&remaining<=86400000&&!items.some(s=>s.kind==='submission'&&s.assignment_id===i.id&&s.owner_id===Number(user.id)))add(`due:${i.id}:${i.due}`,'Assignment due soon',i.title,i.due,'planner');
   }
   if(i.kind==='submission'&&i.owner_id===Number(user.id)&&i.grade)add(`grade:${i.id}:${i.grade.reviewed_at}`,'Assignment reviewed',`${i.grade.score}/${i.grade.maximum} · ${i.grade.feedback||'Your teacher has returned feedback.'}`,i.grade.reviewed_at,'planner');
  }
  const discussions=(await query('SELECT * FROM discussion_items')).rows.map(r=>({...JSON.parse(r.PAYLOAD),id:Number(r.ID),kind:r.KIND,owner_id:Number(r.OWNER_ID)})).filter(r=>r.scope===scope(user));
  const ownThreads=new Set(discussions.filter(r=>r.owner_id===Number(user.id)).map(r=>r.kind==='post'?r.id:r.post_id));
  for(const r of discussions.filter(r=>r.kind==='reply'&&!r.deleted&&r.owner_id!==Number(user.id)&&ownThreads.has(r.post_id)&&discussions.some(p=>p.id===r.post_id&&!p.deleted)))add(`reply:${r.id}`,'New discussion reply',`${r.author} replied to a discussion you joined.`,r.created_at,'discussions');
  for(const r of (await store.all()).filter(r=>r.kind==='mark'&&r.student_id===Number(user.id)&&ids.has(r.class_id)))add(`result:${r.id}:${r.reviewed_at}`,'Exam result published',`${r.title}: ${r.score}/${r.maximum}`,r.reviewed_at,'planner');
  const notices=(await query('SELECT * FROM notices')).rows||[];
  const eq=(a,b)=>String(a).toUpperCase()===String(b).toUpperCase();
  for(const n of notices.filter(n=>eq(n.ACADEMIC_YEAR,user.academic_year)&&eq(n.BRANCH,user.branch)&&(!n.DIVISION||eq(n.DIVISION,user.division))&&(!n.BATCH||eq(n.BATCH,user.batch))))add(`notice:${n.ID}`,n.TITLE,'A new class notice is available.',n.CREATED_AT,'notices');
  return notes.sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,50);
 };
 const configured=()=>Boolean(process.env.VAPID_PUBLIC_KEY&&process.env.VAPID_PRIVATE_KEY&&process.env.VAPID_SUBJECT);
 const tick=async()=>{
  if(!configured())return;
  const all=await store.all(),students=(await query('SELECT * FROM students')).rows;
  for(const sub of all.filter(r=>r.kind==='push')){
   const s=students.find(s=>Number(s.ID)===sub.owner_id);if(!s){await store.remove(sub.id);continue;}
   const user={id:s.ID,academic_year:s.ACADEMIC_YEAR,branch:s.BRANCH,division:s.DIVISION,batch:s.BATCH};
   const current=await feed(user),fresh=current.filter(n=>!(sub.seen||[]).includes(n.id));
   if(!fresh.length)continue;
   try{
    await require('web-push').sendNotification(sub.subscription,JSON.stringify({title:'StudyFlow update',body:'You have new class activity or an upcoming deadline. Open StudyFlow to view it.',view:'notices'}),{vapidDetails:{subject:process.env.VAPID_SUBJECT,publicKey:process.env.VAPID_PUBLIC_KEY,privateKey:process.env.VAPID_PRIVATE_KEY},TTL:3600,timeout:10000});
    await store.update(sub,{seen:current.map(n=>n.id),last_sent:new Date().toISOString()});
   }catch(e){if([404,410].includes(e.statusCode))await store.remove(sub.id);else console.warn('Push delivery failed; will retry on next check.');}
  }
 };
 return {store,feed,configured,tick};
}
module.exports=function notificationRoutes({app,authenticateJWT,query}){
 const service=notificationService(query);app.use('/api/notifications',authenticateJWT,(req,res,next)=>req.user.role==='student'?next():res.status(403).json({error:'Student access required.'}));
 app.get('/api/notifications',route(async(req,res)=>res.json({items:await service.feed(req.user),push_available:service.configured(),public_key:service.configured()?process.env.VAPID_PUBLIC_KEY:null})));
 app.post('/api/notifications/subscribe',route(async(req,res)=>{
  if(!service.configured())fail(503,'Push notifications have not been configured on this server.');
  const sub=req.body.subscription;let endpoint;try{endpoint=new URL(sub?.endpoint);}catch{fail(400,'Invalid subscription.');}
  const host=endpoint.hostname;
  if(endpoint.protocol!=='https:'||endpoint.port||endpoint.username||endpoint.password||!(host==='fcm.googleapis.com'||host==='updates.push.services.mozilla.com'||host==='web.push.apple.com'||host.endsWith('.notify.windows.com')))fail(400,'Unsupported push service.');
  if(typeof sub.keys?.p256dh!=='string'||typeof sub.keys?.auth!=='string'||Buffer.from(sub.keys.p256dh,'base64url').length!==65||Buffer.from(sub.keys.auth,'base64url').length!==16)fail(400,'Invalid subscription keys.');
  const all=await service.store.all(),old=all.find(r=>r.kind==='push'&&r.subscription.endpoint===sub.endpoint);
  if(all.filter(r=>r.kind==='push'&&r.owner_id===Number(req.user.id)).length>=5&&!old)fail(400,'Up to five devices may receive notifications.');
  if(old)await service.store.remove(old.id);
  await service.store.add('push',req.user.id,{subscription:{endpoint:sub.endpoint,keys:{p256dh:sub.keys.p256dh,auth:sub.keys.auth}},seen:(await service.feed(req.user)).map(n=>n.id)});res.status(201).json({success:true});
 }));
 app.post('/api/notifications/unsubscribe',route(async(req,res)=>{
  for(const r of (await service.store.all()).filter(r=>r.kind==='push'&&r.owner_id===Number(req.user.id)&&r.subscription.endpoint===req.body.endpoint))await service.store.remove(r.id);res.json({success:true});
 }));
 return service;
};
module.exports.notificationService=notificationService;
