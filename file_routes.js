'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { records, route, fail, scope } = require('./app_records');

module.exports = function fileRoutes({ app, authenticateJWT, query }) {
  const store = records(query);
  // These files are never exposed through Express static middleware.
  const directory = path.resolve(process.env.PRIVATE_UPLOADS_DIR || path.join(__dirname, '.local-data', 'private-files'));
  const upload = multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024,files:1,fields:0}}).single('file');
  const permitted = async (u, type, id, write=false) => {
    if (!['submission','discussion'].includes(type)) fail(404,'File target not found.');
    const rows=(await query(type==='submission'?'SELECT * FROM campus_items':'SELECT * FROM discussion_items')).rows;
    const row=rows.find(r=>Number(r.ID)===Number(id) && (type==='submission'?r.KIND==='submission':['post','reply'].includes(r.KIND)));
    if(!row)fail(404,'File target not found.');
    const item={...JSON.parse(row.PAYLOAD),id:Number(row.ID),owner_id:Number(row.OWNER_ID),class_id:Number(row.CLASS_ID)};
    const classes=(await query('SELECT * FROM classes')).rows;
    if(type==='submission'){
      const cls=classes.find(c=>Number(c.ID)===item.class_id);
      const allowed=cls && (u.role==='teacher'?Number(cls.TEACHER_ID)===Number(u.id):u.role==='student'&&item.owner_id===Number(u.id)&&scope(cls)===scope(u));
      if(!allowed)fail(404,'File target not found.');
      if(write){const parent=rows.find(r=>Number(r.ID)===item.assignment_id && r.KIND==='assignment');if(!parent||JSON.parse(parent.PAYLOAD).archived)fail(409,'This assignment is archived.');}
    }else{
      if(item.deleted)fail(404,'Message was deleted.');
      const allowed=u.role==='student'?item.scope===scope(u):u.role==='teacher'&&classes.some(c=>Number(c.TEACHER_ID)===Number(u.id)&&scope(c)===item.scope);
      if(!allowed)fail(404,'File target not found.');
    }
    if(write && (u.role!=='student'||item.owner_id!==Number(u.id)))fail(403,'Only the author can change attachments.');
    return {item,row};
  };
  const invalidateGrade=async (type,row)=>{
    if(type!=='submission')return;
    const payload=JSON.parse(row.PAYLOAD);
    const parent=(await query('SELECT * FROM campus_items')).rows.find(r=>Number(r.ID)===payload.assignment_id);
    const due=parent?JSON.parse(parent.PAYLOAD).due:null;
    await query('UPDATE campus_items SET payload = :payload WHERE id = :id',{id:Number(row.ID),payload:JSON.stringify({...payload,grade:null,submitted_at:new Date().toISOString(),late:due?Date.now()>Date.parse(due):payload.late})});
  };
  app.use('/api/files',authenticateJWT);
  const limiter=rateLimit({windowMs:60000,limit:15,keyGenerator:req=>`${req.user.role}:${req.user.id}`,message:{error:'Please wait a minute before uploading more files.'}});
  app.get('/api/files/:type/:id',route(async(req,res)=>{
    await permitted(req.user,req.params.type,req.params.id);
    const files=(await store.all()).filter(r=>r.kind==='file'&&r.target_type===req.params.type&&r.target_id===Number(req.params.id));
    res.json({files:files.map(({disk,...f})=>f)});
  }));
  app.post('/api/files/:type/:id',limiter,route(async(req,res)=>{
    const {row}=await permitted(req.user,req.params.type,req.params.id,true);
    if((await store.all()).filter(r=>r.kind==='file'&&r.target_type===req.params.type&&r.target_id===Number(req.params.id)).length>=3)fail(400,'Up to three attachments are allowed.');
    await new Promise((resolve,reject)=>upload(req,res,e=>e?reject(Object.assign(e,{status:400})):resolve()));
    const file=req.file;if(!file)fail(400,'Choose a PDF, PNG or JPEG file (up to 10 MB).');
    const b=file.buffer;
    const mime=b.subarray(0,5).toString()==='%PDF-'?'application/pdf':b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':b[0]===255&&b[1]===216&&b[2]===255?'image/jpeg':null;
    if(!mime || mime!==file.mimetype)fail(400,'The file content must match PDF, PNG or JPEG.');
    const disk=crypto.randomUUID(); await fs.mkdir(directory,{recursive:true}); await fs.writeFile(path.join(directory,disk),b,{flag:'wx'});
    try{
      await invalidateGrade(req.params.type,row);
      const id=await store.add('file',req.user.id,{target_type:req.params.type,target_id:Number(req.params.id),name:path.basename(file.originalname).replace(/[\x00-\x1f]/g,'').slice(0,120),mime,size:file.size,disk});
      res.status(201).json({id});
    }catch(e){await fs.unlink(path.join(directory,disk)).catch(()=>{});throw e;}
  }));
  app.get('/api/files/download/:id/content',route(async(req,res)=>{
    const file=(await store.all()).find(r=>r.kind==='file'&&r.id===Number(req.params.id));if(!file)fail(404,'File not found.');
    await permitted(req.user,file.target_type,file.target_id);
    res.set({'Content-Type':file.mime,'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store'});
    res.download(path.join(directory,file.disk),file.name);
  }));
  app.delete('/api/files/:id',route(async(req,res)=>{
    const file=(await store.all()).find(r=>r.kind==='file'&&r.id===Number(req.params.id));if(!file)fail(404,'File not found.');
    const {row}=await permitted(req.user,file.target_type,file.target_id,true);
    await invalidateGrade(file.target_type,row);await store.remove(file.id);await fs.unlink(path.join(directory,file.disk)).catch(()=>{});res.json({success:true});
  }));
};
