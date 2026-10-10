import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest=JSON.parse(fs.readFileSync(path.join(root,'production/manifest.json')));
let failures=0;
for(const [name,record] of Object.entries(manifest.projects)){let matches=0;const build=name==='cashflow'?path.join(root,'dist'):name==='tarot'?path.join(root,'xibbofish/tarot/dist'):name==='liuyao'?path.join(root,'xibbofish/liuyao'):path.join(root,name,'dist');
 for(const [file,expected] of Object.entries(record.files)){const snapshot=path.join(root,'production',name,file);const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');if(!fs.existsSync(snapshot)||hash(snapshot)!==expected.sha256){console.error('Snapshot mismatch: '+name+'/'+file);failures++;continue;}
 if(['release.json','SOURCES.md'].includes(file))continue;const candidate=path.join(build,file);
 if(name==='cashflow'&&!fs.existsSync(candidate)&&file.startsWith('assets/'))continue;
 if(!fs.existsSync(candidate)){console.error('Missing build: '+name+'/'+file);failures++;continue;}
 if(file==='build-summary.json'){const a=JSON.parse(fs.readFileSync(snapshot)),b=JSON.parse(fs.readFileSync(candidate));delete a.builtAt;delete b.builtAt;if(JSON.stringify(a)!==JSON.stringify(b)){console.error('Build metadata differs: '+name);failures++;}continue;}
 if(hash(candidate)!==expected.sha256){console.error('Build mismatch: '+name+'/'+file);failures++;}else matches++;
 }console.log(name+': '+matches+' build files verified; release '+record.release);
}
process.exitCode=failures?1:0;
