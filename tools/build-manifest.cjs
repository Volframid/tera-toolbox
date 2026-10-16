'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'..'),list=JSON.parse(fs.readFileSync(path.join(root,'distribution-files.json'),'utf8')).files;
const files={};
for(const name of list){
 if(typeof name!=='string'||name.includes('\\')||name.startsWith('/')||name.split('/').some(p=>p==='..'||p==='.'||!p))throw Error('Invalid public path: '+name);
 if(/(?:LOCAL_UPDATES|user-assets|ui-backups|profiles|\.jsonl$|\.log$)/i.test(name))throw Error('Private path in public allowlist: '+name);
 if(name==='manifest.json'||name.startsWith('mods/'))continue;
 const bytes=fs.readFileSync(path.join(root,name));
 files[name]=crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
}
fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify({files},null,2)+'\n');
console.log('Built self-update manifest: '+Object.keys(files).length+' explicitly allowed files; no user configuration or modules.');
