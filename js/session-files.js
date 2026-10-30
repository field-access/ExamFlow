/* Portable session files work independently of IndexedDB's storage capacity. */
function downloadQuizJSON(data,filename){
 const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
 const link=document.createElement('a');link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function quizJSONFilename(name,kind){return (String(name||'quiz').replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').slice(0,90)||'quiz')+'-'+kind+'.json'}
function captureCurrentSession(){
 if(!questions.length)return null;
 const sid=sessionId||id();
 return cloneData({id:sid,examId:examId||sid,name:examName,questions,answers,reviews:[...reviews],checkedQuestions:[...checkedQuestions],matchOrders,current,seconds,quizDurationMinutes,mode,sections,examFinished,examTimerSeconds:timerState.examSeconds,practiceTimerSeconds:timerState.practiceSeconds,practiceTimerRunning:timerState.running,timerRunning:timerState.running,updatedAt:new Date().toISOString()});
}
async function saveSessionConfirmed(){
 try{
  await QuizStorage.ready;clearTimeout(saveTimer);
  const session=saveSession();if(!session){toast(questions.length?'This session changed or was deleted. Reopen it before saving.':'Load a quiz before saving a session.');return}
  await QuizStorage.flush();toast('Session saved ✓');
 }catch(error){toast('Session could not be saved. Download session JSON to keep your progress.');}
}
function exportSessionJSON(sid){
 // Capture first so a pending autosave, failed database, or another tab cannot lose the latest answers.
 const session=(!sid||sid===sessionId)?captureCurrentSession():get(K.sessions,[]).find(s=>s.id===sid);
 if(!session){toast('No session to download. Load a quiz first.');return}
 downloadQuizJSON({format:'quizflow-session',version:1,exportedAt:new Date().toISOString(),session},quizJSONFilename(session.name,'session'));
 toast('Session JSON downloaded.');
}
function validateSessionJSON(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||!Array.isArray(value.questions)||!value.questions.length||value.questions.length>10000)throw Error('Session needs 1–10,000 questions.');
 const qs=value.questions.map(q=>{
  if(!q||typeof q!=='object'||Array.isArray(q))throw Error('Invalid session question.');
  // Stored true/false questions use option letters; the JSON quiz importer expects booleans.
  const source=q.type==='true_false'&&['A','B'].includes(q.answer)?{...q,answer:q.answer==='A'}:q;
  return normalize(source);
 });
 if(!Array.isArray(value.answers)||value.answers.length!==qs.length)throw Error('Session answers must match the question count.');
 const answers=value.answers.map(a=>{
  if(a===null||typeof a==='string'||typeof a==='boolean'||typeof a==='number'&&Number.isFinite(a))return a;
  if(Array.isArray(a)&&a.every(v=>v===null||typeof v==='string'||typeof v==='number'&&Number.isFinite(v)))return a;
  throw Error('Invalid saved answer.');
 });
 const indices=list=>{if(list===undefined)return [];if(!Array.isArray(list)||list.some(i=>!Number.isInteger(i)||i<0||i>=qs.length))throw Error('Invalid saved review marks.');return [...new Set(list)]};
 const seconds=(number,fallback)=>Number.isFinite(number)&&number>=0?Math.min(3600,number):fallback;
 const duration=clampDurationMinutes(value.quizDurationMinutes||Math.ceil((value.seconds||300)/60));
 const matchOrders={};
 for(const [key,order] of Object.entries(value.matchOrders||{})){
  const index=Number(key),size=qs[index]?.pairs?.length;
  if(!Number.isInteger(index)||index<0||index>=qs.length||!size||!Array.isArray(order)||order.length!==size||order.some(v=>typeof v!=='string')||JSON.stringify([...order].sort())!==JSON.stringify(qs[index].pairs.map(p=>p.right).sort()))throw Error('Invalid saved matching order.');
  matchOrders[index]=order;
 }
 if(value.sections!==undefined&&(!Array.isArray(value.sections)||value.sections.some(s=>!s||typeof s!=='object'||typeof s.name!=='string')))throw Error('Invalid saved sections.');
 const safeId=s=>typeof s==='string'&&/^[a-zA-Z0-9_.-]{1,120}$/.test(s)?s:id();
 return {id:safeId(value.id),examId:safeId(value.examId),name:typeof value.name==='string'?value.name:'Imported session',questions:qs,answers,reviews:indices(value.reviews),checkedQuestions:indices(value.checkedQuestions),matchOrders,
  current:Number.isInteger(value.current)?Math.min(qs.length-1,Math.max(0,value.current)):0,
  seconds:seconds(value.seconds,duration*60),quizDurationMinutes:duration,mode:value.mode==='practice'?'practice':'exam',sections:value.sections||[],examFinished:value.examFinished===true,
  examTimerSeconds:seconds(value.examTimerSeconds,seconds(value.seconds,duration*60)),practiceTimerSeconds:seconds(value.practiceTimerSeconds,300),
  practiceTimerRunning:!value.examFinished&&!!(value.timerRunning??value.practiceTimerRunning),updatedAt:typeof value.updatedAt==='string'?value.updatedAt:new Date().toISOString()};
}
async function importSessionJSON(data){
 if(data?.format!=='quizflow-session'||data.version!==1)throw Error('Unsupported session JSON version.');
 const session=validateSessionJSON(data.session);
 await QuizStorage.ready;
 clearTimeout(saveTimer);
 if(questions.length&&!examFinished&&!deletedSessionIds.has(sessionId))saveSession();
 const sessions=get(K.sessions,[]);
 // Reimporting a file preserves the existing attempt rather than overwriting newer work.
 if(sessions.some(s=>s.id===session.id))session.id=id();
 sessions.unshift(session);
 await QuizStorage.batch([[K.sessions,JSON.stringify(sessions)]]);
 closeImporter();restoreSession(session.id);renderHome();
}
