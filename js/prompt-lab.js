/* Prompt text lives in JSON files; originals and experiments share one editor. */
let promptLibrary={version:1,activeId:null,prompts:[]};
const promptDrafts=new Map();
const originalPrompts=new Map();
const promptRoles={'original-cbq':'cbq','original-flashcards':'flashcards','original-payload':'payload'};
let localPromptFile=false,promptFileQueue=Promise.resolve();
const promptRole=p=>p&&promptRoles[p.id]||null;
function validPromptLibrary(data){
 if(!data||data.version!==1||!Array.isArray(data.prompts)||!data.prompts.length||data.prompts.length>100)throw Error('Use a prompt library JSON with 1–100 slots.');
 const ids=new Set();
 for(const p of data.prompts){
  if(!p||typeof p.id!=='string'||ids.has(p.id)||typeof p.name!=='string'||!p.name.trim()||typeof p.text!=='string'||p.text.length>100000)throw Error('Each slot needs a unique ID, name and prompt of up to 100,000 characters.');
  ids.add(p.id);
 }
 return {version:1,prompts:data.prompts.map(p=>({id:p.id,name:p.name,text:p.text})),activeId:ids.has(data.activeId)?data.activeId:data.prompts[0].id};
}
function activePrompt(){return promptLibrary.prompts.find(p=>p.id===promptLibrary.activeId)}
function getPromptText(role='cbq'){return promptLibrary.prompts.find(p=>promptRole(p)===role)?.text||''}
function promptStatus(message,error=false){
 const status=document.getElementById('seedPromptStatus');if(!status)return;
 status.textContent=message;status.style.color=error?'var(--bad)':'var(--muted)';
}
function renderPromptSlots(){
 const list=document.getElementById('promptSlotList');if(!list)return;
 list.replaceChildren();
 for(const original of [true,false]){
  const slots=promptLibrary.prompts.filter(p=>!!promptRole(p)===original);
  if(!slots.length)continue;
  const label=document.createElement('div');label.className='prompt-group-label';label.textContent=original?'Originals':'Experimental';list.append(label);
  for(const p of slots){
   const draft=promptDrafts.get(p.id),button=document.createElement('button');
   button.type='button';button.className='prompt-slot'+(p.id===promptLibrary.activeId?' is-active':'');button.setAttribute('aria-pressed',String(p.id===promptLibrary.activeId));
   const title=document.createElement('strong');title.textContent=draft?.name||p.name;button.append(title);
   if(draft){const meta=document.createElement('span');meta.textContent='Unsaved';button.append(meta)}
   button.onclick=()=>selectPromptSlot(p.id);list.append(button);
  }
 }
}
function renderPromptSettings(){
 const editor=document.getElementById('seedPromptEditor');if(!editor)return;
 const p=activePrompt(),draft=p&&promptDrafts.get(p.id),role=promptRole(p);
 document.getElementById('promptSlotName').value=draft?.name??p?.name??'';editor.value=draft?.text??p?.text??'';
 document.querySelectorAll('.prompt-library-edit').forEach(el=>el.disabled=!p);
 document.getElementById('deletePromptBtn').hidden=!p||!!role;
 document.getElementById('restorePromptBtn').hidden=!role;
 document.getElementById('restorePromptBtn').disabled=!originalPrompts.has(p?.id);
 document.getElementById('promptUsage').textContent={cbq:'Hero CBQ prompt',flashcards:'Hero & flashcard prompt',payload:'Question → ChatGPT'}[role]||'Experimental';
 renderPromptSlots();promptStatus(draft?'Unsaved changes':p?'':'Prompts could not be loaded. Serve the app over HTTP.');
}
function backupPromptLibrary(){put('examflow_prompt_library_v1',{...promptLibrary,drafts:Object.fromEntries(promptDrafts)})}
function editPrompt(){
 const p=activePrompt();if(!p)return;
 const draft={name:document.getElementById('promptSlotName').value,text:document.getElementById('seedPromptEditor').value};
 if(draft.name===p.name&&draft.text===p.text)promptDrafts.delete(p.id);else promptDrafts.set(p.id,draft);
 backupPromptLibrary();renderPromptSlots();promptStatus(promptDrafts.has(p.id)?'Unsaved changes':'');
}
function selectPromptSlot(value){if(!promptLibrary.prompts.some(p=>p.id===value))return;promptLibrary.activeId=value;backupPromptLibrary();renderPromptSettings()}
function savedPromptJSON(){return JSON.stringify({...promptLibrary,prompts:promptLibrary.prompts.map(p=>({...p,...(promptRole(p)?{role:promptRole(p)}:{})}))},null,2)}
function persistPromptFile(){
 if(!localPromptFile)return Promise.resolve(false);
 const content=savedPromptJSON();
 promptFileQueue=promptFileQueue.catch(()=>{}).then(async()=>{
  const response=await fetch('/api/prompts',{method:'POST',headers:{'Content-Type':'application/json'},body:content,signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw Error('Project JSON could not be saved. Your browser copy is kept; use Export JSON.');
  return true;
 });
 return promptFileQueue;
}
async function savePrompt(){
 const p=activePrompt();if(!p)return false;
 const name=document.getElementById('promptSlotName').value.trim(),text=document.getElementById('seedPromptEditor').value;
 if(!name||!text.trim()||text.length>100000){promptStatus('Enter a name and prompt of up to 100,000 characters.',true);return false}
 p.name=name;p.text=text;promptDrafts.delete(p.id);backupPromptLibrary();renderPromptSettings();window.GeminiGenerator?.refresh();
 promptStatus(localPromptFile?'Saving project JSON…':'Saved in browser · Export JSON for a file copy');
 try{if(await persistPromptFile())promptStatus('Saved to prompt-library.json')}catch(error){promptStatus(error.message,true)}
 return true;
}
function addPromptSlot(){
 if(promptLibrary.prompts.length>=100){promptStatus('Maximum 100 slots. Delete an unused experiment first.',true);return}
 const p={id:id(),name:'Experiment '+(promptLibrary.prompts.filter(p=>!promptRole(p)).length+1),text:''};
 promptLibrary.prompts.push(p);promptLibrary.activeId=p.id;promptDrafts.set(p.id,{name:p.name,text:''});backupPromptLibrary();renderPromptSettings();document.getElementById('promptSlotName').focus();
}
async function deletePromptSlot(){
 const p=activePrompt();if(!p||promptRole(p))return;
 if(!confirm('Delete “'+p.name+'”?'))return;
 promptLibrary.prompts=promptLibrary.prompts.filter(item=>item.id!==p.id);promptDrafts.delete(p.id);promptLibrary.activeId=promptLibrary.prompts[0]?.id;
 backupPromptLibrary();renderPromptSettings();try{await persistPromptFile()}catch(error){promptStatus(error.message,true)}
}
function copyEditedPrompt(){
 const text=document.getElementById('seedPromptEditor').value;
 if(!text.trim()){promptStatus('Write a prompt before copying.',true);return}
 copyBeginnerSchema(text);
}
async function restoreOriginalPrompt(){
 const p=activePrompt(),original=p&&originalPrompts.get(p.id);if(!original)return;
 if(!confirm('Restore the shipped “'+original.name+'” prompt? This replaces its saved text and pending edits.'))return;
 Object.assign(p,original);promptDrafts.delete(p.id);backupPromptLibrary();renderPromptSettings();window.GeminiGenerator?.refresh();
 try{await persistPromptFile();promptStatus('Original restored.')}catch(error){promptStatus(error.message,true)}
}
function exportPromptLibrary(){
 const url=URL.createObjectURL(new Blob([savedPromptJSON()],{type:'application/json'})),link=document.createElement('a');
 link.href=url;link.download='prompt-library.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 document.querySelector('.prompt-file-menu').open=false;
 promptStatus('Saved prompts exported. Save pending edits before exporting them.');
}
async function importPromptLibrary(event){
 const file=event.target.files?.[0];event.target.value='';if(!file)return;
 try{
  if(file.size>3000000)throw Error('Prompt JSON must be under 3 MB.');
  const imported=validPromptLibrary(JSON.parse(await file.text()));
  for(const [key,p] of originalPrompts)if(!imported.prompts.some(p=>p.id===key))imported.prompts.unshift({...p});
  if(imported.prompts.length>100)throw Error('Maximum 100 slots including originals.');
  if(!confirm('Replace your prompt slots with this JSON file?'))return;
  promptLibrary=imported;promptDrafts.clear();backupPromptLibrary();renderPromptSettings();window.GeminiGenerator?.refresh();
  await persistPromptFile();promptStatus('Prompts imported.');
 }catch(error){promptStatus(error.message,true)}
}
async function initPromptLibrary(){
 let defaults={version:1,activeId:null,prompts:[]};
 try{
  const responses=await Promise.all([fetch('original-prompts.json'),fetch('seed-prompts.json')]);
  if(responses.some(r=>!r.ok))throw Error('Prompt files unavailable');
  const [originals,seeds]=await Promise.all(responses.map(r=>r.json()));
  originalPrompts.clear();for(const p of validPromptLibrary(originals).prompts)originalPrompts.set(p.id,p);
  defaults={version:1,activeId:'original-cbq',prompts:[...originalPrompts.values(),...validPromptLibrary(seeds).prompts]};
 }catch{}
 let backup=get('examflow_prompt_library_v1',null);
 if(location.protocol!=='file:')try{
  const response=await fetch('/api/prompts',{cache:'no-store',signal:AbortSignal.timeout(2000)});
  if(response.ok){
   const data=await response.json();localPromptFile=data.localFile===true;
   if(data.library){
    const browser=backup,drafts={};
    for(const [key,draft] of Object.entries(browser?.drafts||{})){
     const previous=browser.prompts?.find(p=>p.id===key),saved=data.library.prompts.find(p=>p.id===key);
     if(previous&&saved&&previous.text===saved.text&&previous.name===saved.name)drafts[key]=draft;
     else if(previous&&!saved){data.library.prompts.push(previous);drafts[key]=draft;}
    }
    backup={...data.library,activeId:browser?.activeId||data.library.activeId,drafts};
   }
  }
 }catch{}
 promptDrafts.clear();promptLibrary=defaults;
 try{
  if(backup){
   const saved=validPromptLibrary(backup),legacy=saved.prompts.find(p=>p.id===saved.activeId);
   // Preserve the previously selected hero prompt during the first Originals migration.
   const migrating=!saved.prompts.some(p=>p.id==='original-cbq');
   for(const p of defaults.prompts.filter(promptRole))if(!saved.prompts.some(item=>item.id===p.id))saved.prompts.push({...p,text:migrating&&p.id==='original-cbq'?(settings.seedPrompt||legacy?.text||p.text):p.text});
   promptLibrary=saved;
   for(const [key,draft] of Object.entries(backup.drafts||{}))if(saved.prompts.some(p=>p.id===key)&&typeof draft?.text==='string'&&typeof draft?.name==='string')promptDrafts.set(key,draft);
  }
 }catch{}
 if(!backup&&settings.seedPrompt){const p=promptLibrary.prompts.find(p=>p.id==='original-cbq');if(p)p.text=settings.seedPrompt}
 renderPromptSettings();
}
