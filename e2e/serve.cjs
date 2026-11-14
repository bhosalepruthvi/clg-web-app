const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'studyflow-browser-'));
process.env.PORT='4173';process.env.SERVE_FRONTEND='1';process.env.LOCAL_STORE_PATH=path.join(dir,'store.json');process.env.UPLOADS_DIR=path.join(dir,'uploads');process.env.AUTH_RATE_LIMIT_OVERRIDE='1000';
process.env.PRIVATE_UPLOADS_DIR=path.join(dir,'private-files');process.env.ADMIN_TEACHER_IDS='1';
const {app,setQueryExecutor}=require('../server_studyflow_v2');
const {createLocalStore}=require('../local_dev_store');
setQueryExecutor(createLocalStore({file:process.env.LOCAL_STORE_PATH}).executor);
app.listen(4173,'127.0.0.1');

