import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest=JSON.parse(fs.readFileSync(path.join(root,'production/manifest.json'),'utf8'));
let count=0;
for(const [name,record] of Object.entries(manifest.projects)){
 for(const [file,expected] of Object.entries(record.files)){
  const target=path.resolve(root,'production',name,file);
  if(!target.startsWith(path.resolve(root,'production')+path.sep))throw new Error('Invalid snapshot path');
  const bytes=fs.readFileSync(target);
  if(bytes.length!==expected.bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==expected.sha256)throw new Error('Snapshot mismatch: '+name+'/'+file);
  count++;
 }
 console.log(name+': '+Object.keys(record.files).length+' files verified ('+record.release+')');
}
console.log('Verified '+count+' production files. Development builds may differ; see docs/SYNC-20261018.md.');
