'use strict';
// Generate keys locally; never print private keys or overwrite existing settings.
const fs=require('node:fs'),path=require('node:path');
const subject=process.argv[2];
if(!subject||!/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subject)){
 console.error('Usage: node setup_push.js mailto:YOUR_REAL_CONTACT_EMAIL');process.exitCode=1;
}else{
 const target=path.join(__dirname,'.env'),current=fs.existsSync(target)?fs.readFileSync(target,'utf8'):'';
 if(/^VAPID_(PUBLIC_KEY|PRIVATE_KEY|SUBJECT)=/m.test(current)){console.error('VAPID settings already exist in .env. Existing keys were preserved.');process.exitCode=1;}
 else{const keys=require('web-push').generateVAPIDKeys();fs.appendFileSync(target,`\nVAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\nVAPID_SUBJECT=${subject}\n`,{mode:0o600});console.log('Push settings saved to the ignored local .env file. Restart the backend to enable delivery.');}
}
