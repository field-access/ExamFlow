/* Local-only prompt JSON persistence. No AI credentials or study data are accepted. */
import { readFile, writeFile, rename, unlink, lstat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
let writing=Promise.resolve();
function validate(data){
  if(!data||data.version!==1||!Array.isArray(data.prompts)||!data.prompts.length||data.prompts.length>100)throw Error('Invalid prompt library.');
  const ids=new Set();
  for(const p of data.prompts){
    if(!p||typeof p.id!=='string'||ids.has(p.id)||typeof p.name!=='string'||!p.name.trim()||typeof p.text!=='string'||p.text.length>100000)throw Error('Invalid prompt slot.');
    ids.add(p.id);
  }
  return {version:1,activeId:ids.has(data.activeId)?data.activeId:data.prompts[0].id,prompts:data.prompts.map(({id,name,text})=>({id,name,text}))};
}
export async function promptFileRequest(req,res,root,json){
  const target=path.join(root,'prompt-library.json');
  try{
    const stat=await lstat(target).catch(error=>{if(error.code==='ENOENT')return null;throw error});
    if(stat&&(!stat.isFile()||stat.isSymbolicLink()))return json(res,403,{error:'Prompt storage must be a regular project JSON file.'});
    if(req.method==='GET'){
      await writing.catch(()=>{});
      const library=await readFile(target,'utf8').then(text=>validate(JSON.parse(text))).catch(error=>{if(error.code==='ENOENT')return null;throw error});
      return json(res,200,{localFile:true,library});
    }
    if(req.method!=='POST'){res.setHeader('Allow','GET, POST');return json(res,405,{error:'Use GET or POST for prompts.'})}
    // Mutations require the local app's exact origin, already checked by dev.mjs.
    if(!req.headers.origin||req.headers['sec-fetch-site']==='cross-site')return json(res,403,{error:'Save prompts from the local app.'});
    if(!String(req.headers['content-type']||'').includes('application/json'))return json(res,415,{error:'Send prompt JSON.'});
    const chunks=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>3000000)return json(res,413,{error:'Prompt JSON must be under 3 MB.'});chunks.push(chunk)}
    let library;try{library=validate(JSON.parse(Buffer.concat(chunks).toString('utf8')))}catch{return json(res,400,{error:'Invalid prompt library JSON.'})}
    writing=writing.catch(()=>{}).then(async()=>{
      const temporary=path.join(root,'.prompt-library-'+randomUUID()+'.tmp');
      try{await writeFile(temporary,JSON.stringify(library,null,2)+'\n',{flag:'wx'});await rename(temporary,target)}
      finally{await unlink(temporary).catch(()=>{})}
    });
    await writing;json(res,200,{saved:true});
  }catch{json(res,500,{error:'Project prompt JSON could not be read or saved. Export your browser copy.'})}
}
