/* IndexedDB is the source of truth. The synchronous cache contains only this visit's data. */
(() => {
  'use strict';
  const DB='QuizFlowLibrary_v1',STORE='records',META='meta';
  const cache=new Map(),pending=new Map();
  let db=null,mode='loading',lastError='',protectionMessage='',writing=null,exclusive=false,panelTimer=null;
  const managed=key=>typeof key==='string'&&/^examflow_[a-z0-9_]+$/i.test(key);
  const localGet=key=>{try{return localStorage.getItem(key)}catch{return null}};
  const legacy=new Map();
  try{for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(managed(key)){const value=localGet(key);if(value!==null)legacy.set(key,value)}}}catch{}
  for(const [key,value] of legacy)cache.set(key,value);
  function announce(){window.dispatchEvent(new CustomEvent('quizflow-storage-status'));clearTimeout(panelTimer);panelTimer=setTimeout(updatePanel,120)}
  function failure(message){lastError=message;announce();updatePanel()}
  function open(name,version,upgrade){return new Promise((resolve,reject)=>{
    const request=indexedDB.open(name,version);
    request.onupgradeneeded=()=>upgrade?.(request.result);
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(new Error('Close other QuizFlow tabs, then reload to open the library.'));
  })}
  function transaction(entries,metadata){return new Promise((resolve,reject)=>{
    const tx=db.transaction(metadata?[STORE,META]:[STORE],'readwrite'),store=tx.objectStore(STORE);
    for(const [key,value] of entries){if(value===null)store.delete(key);else store.put(value,key)}
    if(metadata)tx.objectStore(META).put(metadata,'initialized');
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Save interrupted'));
  })}
  async function oldSnapshot(name,store){
    let connection;
    try{
      const request=indexedDB.open(name);
      connection=await new Promise((resolve,reject)=>{request.onupgradeneeded=()=>{request.transaction.abort()};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
      if(!connection.objectStoreNames.contains(store))return null;
      return await new Promise((resolve,reject)=>{const req=connection.transaction(store,'readonly').objectStore(store).get('latest');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});
    }catch{return null}finally{connection?.close()}
  }
  async function initialize(){
    if(!window.indexedDB){mode='local';failure('IndexedDB is unavailable. Using limited localStorage; export your library regularly.');return}
    try{
      db=await open(DB,1,connection=>{connection.createObjectStore(STORE);connection.createObjectStore(META)});
      const loaded=await new Promise((resolve,reject)=>{
        const tx=db.transaction([STORE,META],'readonly'),store=tx.objectStore(STORE);
        const keys=store.getAllKeys(),values=store.getAll(),initialized=tx.objectStore(META).get('initialized');
        tx.oncomplete=()=>resolve({keys:keys.result,values:values.result,initialized:initialized.result});tx.onerror=()=>reject(tx.error);
      });
      cache.clear();loaded.keys.forEach((key,i)=>cache.set(key,loaded.values[i]));
      if(!loaded.initialized){
        const reset=legacy.get('examflow_last_reset');
        const snapshots=await Promise.all([oldSnapshot('ExamFlowPersistentBackup_v1','backup'),oldSnapshot('examflow_persistent_backup_v1','app_state')]);
        for(const [key,value] of legacy)if(!cache.has(key))cache.set(key,value);
        snapshots.filter(s=>s?.data&&(!reset||String(s.savedAt||'')>reset)).sort((a,b)=>String(b.savedAt).localeCompare(String(a.savedAt))).forEach(snapshot=>{
          for(let [key,value] of Object.entries(snapshot.data)){
            if(key==='examDeadline')key='examflow_exam_deadline';
            if(managed(key)&&!cache.has(key)&&value!==null)cache.set(key,typeof value==='string'?value:JSON.stringify(value));
          }
        });
        await transaction([...cache],{migratedAt:new Date().toISOString()});
        // Remove old cache entries only after the migration transaction has committed.
        for(const [key,value] of legacy)try{if(localGet(key)===value)localStorage.removeItem(key)}catch{}
      }
      mode='indexeddb';db.onversionchange=()=>{db.close();mode='failed';failure('The library changed in another tab. Reload this page before saving.')};
    }catch(error){mode='failed';failure('Could not open or migrate your library. Existing data was retained. Close other tabs and reload; saving is disabled.');}
  }
  const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('quizflow-library-v1'):null;
  async function flush(){
    if(mode!=='indexeddb')return;
    if(writing){await writing;if(pending.size)return flush();return}
    if(!pending.size)return;
    const batch=[...pending];pending.clear();
    writing=transaction(batch).then(()=>{
      lastError='';channel?.postMessage({keys:batch.map(([key])=>key)});
    }).catch(error=>{
      for(const [key,value] of batch)if(!pending.has(key))pending.set(key,value);
      failure(error?.name==='QuotaExceededError'?'Browser storage is full. Your latest changes are only in memory. Export JSON now, then delete redundant quizzes/decks or free disk space.':'Your latest changes could not be saved. Keep this page open, export JSON, and retry saving.');
      throw error;
    }).finally(()=>{writing=null;announce()});
    await writing;
    if(pending.size)return flush();
  }
  function setItem(key,value){
    if(!managed(key))throw new Error('Unknown library storage key');
    if(mode==='loading'||mode==='failed'||exclusive)throw new Error('Library is not ready to save');
    value=String(value);if(cache.get(key)===value)return;
    if(mode==='local')localStorage.setItem(key,value);
    cache.set(key,value);
    if(mode==='indexeddb'){pending.set(key,value);flush().catch(()=>{})}
    announce();
  }
  function removeItem(key){
    if(mode==='loading'||mode==='failed'||exclusive)throw new Error('Library is not ready to save');
    if(mode==='local')localStorage.removeItem(key);
    cache.delete(key);try{localStorage.removeItem(key)}catch{}
    if(mode==='indexeddb'){pending.set(key,null);flush().catch(()=>{})}
    announce();
  }
  async function batch(entries){
    if(mode!=='indexeddb')throw new Error('IndexedDB must be available to import the library safely.');
    if(entries.some(([key,value])=>!managed(key)||(value!==null&&typeof value!=='string')))throw new Error('Invalid library records');
    if(exclusive)throw new Error('Another library operation is in progress.');
    exclusive=true;
    const cover=document.createElement('div');cover.id='libraryLoading';cover.setAttribute('role','status');cover.textContent='Saving library changes…';document.body.append(cover);
    try{
      await flush();await transaction(entries);
      for(const [key,value] of entries){if(value===null)cache.delete(key);else cache.set(key,value)}
      lastError='';channel?.postMessage({keys:entries.map(([key])=>key)});announce();
    }finally{exclusive=false;cover.remove()}
  }
  if(channel)channel.onmessage=async event=>{
    await ready;if(mode!=='indexeddb'||!Array.isArray(event.data?.keys))return;
    const keys=event.data.keys.filter(managed);
    if(writing||pending.size){failure('Another tab changed the library while this page has unsaved changes. Export this page before reloading.');return}
    try{
      const values=await new Promise((resolve,reject)=>{
        const tx=db.transaction(STORE,'readonly'),requests=keys.map(key=>tx.objectStore(STORE).get(key));
        tx.oncomplete=()=>resolve(requests.map(r=>r.result));tx.onerror=()=>reject(tx.error);
      });
      keys.forEach((key,i)=>{if(values[i]===undefined)cache.delete(key);else cache.set(key,values[i])});
      window.dispatchEvent(new CustomEvent('quizflow-library-change',{detail:{keys}}));announce();
    }catch{failure('Could not refresh changes from another tab. Reload this page.')}
  };
  const bytes=value=>new Blob([value]).size;
  function snapshot(){return Object.fromEntries(cache)}
  async function updatePanel(){
    const warning=document.getElementById('librarySaveWarning');if(warning){warning.hidden=!lastError;warning.textContent=lastError}
    if(!document.getElementById('settingsView')?.classList.contains('active'))return;
    const el=document.getElementById('libraryStorageStatus');if(!el)return;
    const size=[...cache.values()].reduce((sum,value)=>sum+bytes(value),0),format=n=>n>=1073741824?(n/1073741824).toFixed(1)+' GB':n>=1048576?(n/1048576).toFixed(1)+' MB':Math.ceil(n/1024)+' KB';
    let quizzes=0,cards=0;try{quizzes=JSON.parse(cache.get('examflow_exams_v1')||'[]').length;cards=(JSON.parse(cache.get('examflow_flashcards_v1')||'{}').decks||[]).reduce((n,d)=>n+(d.cards?.length||0),0)}catch{}
    const usage=document.getElementById('libraryStorageUsage');if(usage)usage.textContent=format(size)+' library · '+quizzes+' quizzes · '+cards+' flashcards';
    el.textContent=lastError||(mode==='indexeddb'?(writing||pending.size?'Saving changes…':'Saved in IndexedDB'):mode==='loading'?'Loading library…':'Limited browser storage');
    el.classList.toggle('storage-error',!!lastError);
    try{
      const estimate=await navigator.storage?.estimate(),persistent=await navigator.storage?.persisted();
      const capacity=document.getElementById('libraryStorageCapacity');if(capacity)capacity.textContent=(estimate?.quota?format(estimate.usage||0)+' used of '+format(estimate.quota)+' browser allowance · '+(persistent?'Persistence granted':'Best-effort storage'):'')+(protectionMessage?' · '+protectionMessage:'');
    }catch{}
  }
  const ready=initialize().then(()=>{legacy.clear();announce();document.getElementById('libraryLoading')?.remove()});
  window.QuizStorage={ready,getItem:key=>cache.get(key)??null,setItem,removeItem,flush,batch,snapshot,updatePanel,
    async requestPersistence(){try{const granted=await navigator.storage?.persist();protectionMessage=granted?'':'Persistence was not granted; keep JSON backups.';announce()}catch{protectionMessage='Persistence unavailable; keep JSON backups.';announce()}},
    retry(){if(mode==='failed')location.reload();else flush().catch(()=>{})}
  };
  const loading=document.createElement('div');loading.id='libraryLoading';loading.setAttribute('role','status');loading.textContent='Loading your saved library…';document.body.append(loading);
  const warning=document.createElement('div');warning.id='librarySaveWarning';warning.hidden=true;warning.setAttribute('role','alert');document.body.append(warning);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flush().catch(()=>{})});
  window.addEventListener('beforeunload',event=>{if(pending.size){event.preventDefault();event.returnValue=''}});
  document.addEventListener('click',event=>{if(mode==='loading'||exclusive){event.preventDefault();event.stopImmediatePropagation()}},true);
  document.addEventListener('keydown',event=>{if(mode==='loading'||exclusive){event.stopImmediatePropagation();if(!event.ctrlKey&&!event.metaKey)event.preventDefault()}},true);
})();
