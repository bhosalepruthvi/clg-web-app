const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {Resvg}=require('@resvg/resvg-js');
const {TwaManifest,TwaGenerator,ConsoleLog}=require('@bubblewrap/core');
(async()=>{
 const root=path.resolve(__dirname,'..'),publicDir=path.join(root,'react-frontend/public');
 const svg=fs.readFileSync(path.join(publicDir,'icon.svg'));
 for(const size of [192,512]) fs.writeFileSync(path.join(publicDir,`icon-${size}.png`),new Resvg(svg,{fitTo:{mode:'width',value:size}}).render().asPng());
 const web=JSON.parse(fs.readFileSync(path.join(publicDir,'manifest.webmanifest')));
 web.icons=[192,512].map(size=>({src:`/icon-${size}.png`,sizes:`${size}x${size}`,type:'image/png',purpose:'any maskable'}));
 fs.writeFileSync(path.join(publicDir,'manifest.webmanifest'),JSON.stringify(web,null,2)+'\n');
 const server=http.createServer((req,res)=>{if(req.url==='/manifest.webmanifest'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(web));return;}res.setHeader('Content-Type','image/png');res.end(fs.readFileSync(path.join(publicDir,'icon-512.png')));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const manifest=TwaManifest.fromWebManifestJson(new URL('https://studyflowrmd.duckdns.org/manifest.webmanifest'),web);
  manifest.packageId='org.duckdns.studyflowrmd.app';manifest.name='StudyFlow';manifest.launcherName='StudyFlow';manifest.enableNotifications=true;manifest.minSdkVersion=24;
  manifest.signingKey={path:path.join(__dirname,'signing/studyflow-release.jks'),alias:'studyflow'};
  const finalIcon='https://studyflowrmd.duckdns.org/icon-512.png';
  manifest.iconUrl=`http://127.0.0.1:${server.address().port}/icon.png`;manifest.maskableIconUrl=manifest.iconUrl;
  manifest.webManifestUrl=new URL(`http://127.0.0.1:${server.address().port}/manifest.webmanifest`);
  await new TwaGenerator().createTwaProject(path.join(__dirname,'android'),manifest,new ConsoleLog('StudyFlow'));
  const appGradle=path.join(__dirname,'android/app/build.gradle');
  fs.writeFileSync(appGradle,fs.readFileSync(appGradle,'utf8').replace(/http:\/\/127\.0\.0\.1:\d+\/manifest.webmanifest/g,'https://studyflowrmd.duckdns.org/manifest.webmanifest'));
  const rootGradle=path.join(__dirname,'android/build.gradle');
  fs.writeFileSync(rootGradle,fs.readFileSync(rootGradle,'utf8').replaceAll('jcenter()','mavenCentral()'));
  manifest.webManifestUrl=new URL('https://studyflowrmd.duckdns.org/manifest.webmanifest');manifest.iconUrl=finalIcon;manifest.maskableIconUrl=finalIcon;await manifest.saveToFile(path.join(__dirname,'twa-manifest.json'));
 } finally {server.closeAllConnections();server.close();}
})();
