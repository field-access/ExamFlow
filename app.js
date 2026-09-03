const K={sessions:"examflow_sessions_v2",results:"examflow_results_v2",goal:"examflow_goal_v2",plans:"examflow_plans_v2",settings:"examflow_settings_v2",exams:"examflow_exams_v1",recent:"examflow_recent_quizzes_v1",pomodoroStats:"examflow_pomodoro_stats_v1"};
const sampleQuestions=[
{text:"Which algorithm guarantees shortest paths from a source when edge weights are non-negative?",options:["DFS","Dijkstra's algorithm"],answer:"B",marks:2,negativeMarks:.5},
{text:"What is the average-case lookup complexity of a good hash table?",options:["$O(1)$","$O(\\log n)$"],answer:"A"},
{text:"Which data structure naturally implements BFS?",options:["Queue","Stack"],answer:"A"}
];
let questions=[],answers=[],reviews=new Set(),checkedQuestions=new Set(),current=0,seconds=5*60,quizDurationMinutes=5,mode="exam",sessionId=null,examName="No quiz loaded",sections=[];
let examFinished=false;
let examId=null;
let timerState={examSeconds:5*60,practiceSeconds:5*60,running:false};
let universalStudyTimerSeconds = 0;
let universalStudyTimerRunning = true;
let universalStudyTimerMode = 'stopwatch'; // 'stopwatch' or 'countdown'
let pomodoroCycle = 0;
let pomodoroPhase = 'focus';
let pomodoroStats = {sessions:0,minutes:0};

function loadPomodoroStats(){
  const saved=get(K.pomodoroStats,{});
  return {sessions:Math.max(0,Number(saved.sessions)||0),minutes:Math.max(0,Number(saved.minutes)||0)};
}
function savePomodoroStats(){put(K.pomodoroStats,pomodoroStats)}

function setPomodoro(val) {
  if(val === 'stopwatch') {
    universalStudyTimerMode = 'stopwatch';
    universalStudyTimerSeconds = 0;
  } else {
    universalStudyTimerMode = 'countdown';
    universalStudyTimerSeconds = parseInt(val, 10) * 60;
  }
  universalStudyTimerRunning = true;
  pomodoroPhase = val === 'stopwatch' ? 'stopwatch' : (val === '5' || val === '15' ? 'break' : 'focus');
  const btn = document.getElementById("universalTimerToggleBtn");
  if(btn) btn.textContent = "⏸ Pause";
  updateUniversalTimerUI();
}

function toggleUniversalTimer() {
  universalStudyTimerRunning = !universalStudyTimerRunning;
  const btn = document.getElementById("universalTimerToggleBtn");
  if(btn) {
    btn.textContent = universalStudyTimerRunning ? "⏸ Pause" : "▶ Resume";
  }
}

function updateUniversalTimerUI() {
  const gt = document.getElementById("globalTimer");
  if(gt) {
    const hrs = Math.floor(Math.abs(universalStudyTimerSeconds) / 3600);
    const mins = Math.floor((Math.abs(universalStudyTimerSeconds) % 3600) / 60);
    const secs = Math.abs(universalStudyTimerSeconds) % 60;
    const sign = universalStudyTimerSeconds < 0 ? "-" : "";
    gt.textContent = `${sign}${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  const phase=document.getElementById("pomodoroPhase");
  if(phase)phase.textContent=universalStudyTimerMode==='stopwatch'?'Open study timer':(pomodoroPhase==='break'?'Break':'Focus');
  document.querySelectorAll("#pomodoroDots i").forEach((dot,i)=>dot.classList.toggle("active",i<=pomodoroCycle%4));
}
let matchOrders={};
let settings=loadSettings();
restoreFromPersistentStorage().then(()=>{
  try{
    settings=loadSettings();
    renderSessions();
    renderDashboard();
    renderPlans();
    renderHome();
  }catch(e){}
}).finally(()=>requestPersistentStorage());

function get(k,d){try{return JSON.parse(localStorage.getItem(k)||JSON.stringify(d))}catch(e){return d}}
function put(k,v){
  try{localStorage.setItem(k,JSON.stringify(v))}catch(e){
    // localStorage is intentionally kept as the fast cache; large data is backed up below.
  }
  schedulePersistentBackup();
}
pomodoroStats=loadPomodoroStats();

/* Persistent data backup: IndexedDB is substantially larger than localStorage.
   localStorage remains the fast synchronous cache, while IndexedDB protects
   quizzes/results/sessions if the browser evicts or fills the cache. */
const EXAMFLOW_DB_NAME="ExamFlowPersistentBackup_v1",EXAMFLOW_DB_VERSION=1;
let examflowBackupTimer=null;
function openExamFlowDB(){return new Promise((resolve,reject)=>{
  if(!window.indexedDB)return reject(new Error("IndexedDB unavailable"));
  const req=indexedDB.open(EXAMFLOW_DB_NAME,EXAMFLOW_DB_VERSION);
  req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains("backup"))req.result.createObjectStore("backup")};
  req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
})}
function schedulePersistentBackup(){
  clearTimeout(examflowBackupTimer);
  examflowBackupTimer=setTimeout(savePersistentBackup,250);
}
async function savePersistentBackup(){
  try{
    const db=await openExamFlowDB();
    const data={};
    Object.values(K).forEach(k=>{try{const v=localStorage.getItem(k);if(v!==null)data[k]=JSON.parse(v)}catch(e){}});
    data.examDeadline=localStorage.getItem("examflow_exam_deadline")||null;
    await new Promise((resolve,reject)=>{
      const tx=db.transaction("backup","readwrite");tx.objectStore("backup").put({data,savedAt:new Date().toISOString()},"latest");
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
    });
    db.close();
  }catch(e){}
}
async function restorePersistentBackup(){
  try{
    const db=await openExamFlowDB();
    const record=await new Promise((resolve,reject)=>{
      const tx=db.transaction("backup","readonly"),req=tx.objectStore("backup").get("latest");
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
    });
    db.close();
    if(!record?.data)return false;
    let restored=false;
    Object.entries(record.data).forEach(([k,v])=>{
      if(Object.values(K).includes(k)){
        if(localStorage.getItem(k)===null){try{localStorage.setItem(k,JSON.stringify(v));restored=true}catch(e){}}
      }
    });
    if(record.data.examDeadline && !localStorage.getItem("examflow_exam_deadline")){
      try{localStorage.setItem("examflow_exam_deadline",record.data.examDeadline);restored=true}catch(e){}
    }
    if(restored){
      try{renderSessions();renderDashboard();renderPlans();renderHome();renderTodos();}catch(e){}
    }
    return restored;
  }catch(e){return false}
}
async function enablePersistentStorage(){
  try{if(navigator.storage?.persist)await navigator.storage.persist()}catch(e){}
}
function initPersistentBackup(){
  enablePersistentStorage();
  restorePersistentBackup();
  setTimeout(savePersistentBackup,500);
}
function id(){return Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,8)}

function cloneData(value){try{return JSON.parse(JSON.stringify(value))}catch(e){return value}}
function saveExamRecord(record){
  if(!record?.id)return;
  const exams=get(K.exams,[]),next={...record,questions:cloneData(record.questions||[]),updatedAt:new Date().toISOString()};
  const old=exams.find(x=>x.id===record.id);
  if(old)Object.assign(old,next);else exams.unshift(next);
  put(K.exams,exams);
}
function registerRecentQuiz(record,metadata={}){
  if(!record?.id)return;
  const recent=get(K.recent,[]),now=new Date().toISOString();
  const old=recent.find(x=>x.id===record.id);
  const next={id:record.id,name:metadata.name||record.name||"Untitled quiz",lastOpenedAt:now,createdAt:old?.createdAt||now,plannedDate:metadata.plannedDate||old?.plannedDate||"",plannedTime:metadata.plannedTime||old?.plannedTime||"",source:metadata.source||old?.source||"quiz"};
  if(old)Object.assign(old,next);else recent.unshift(next);
  recent.sort((a,b)=>String(b.lastOpenedAt||"").localeCompare(String(a.lastOpenedAt||"")));
  put(K.recent,recent);
}
function getExamRecord(idValue){return get(K.exams,[]).find(x=>x.id===idValue)||null}
function registerActiveExam(metadata={}){
  if(!examId)examId=id();
  saveExamRecord({id:examId,name:examName,questions,sections,durationMinutes:quizDurationMinutes});
  registerRecentQuiz({id:examId,name:examName},{...metadata,name:metadata.name||examName});
}
function renderRecentQuizzes(){
  const el=document.getElementById("recentQuizzesList");if(!el)return;
  const recent=get(K.recent,[]),exams=get(K.exams,[]);
  el.innerHTML=renderStackedRows(recent,item=>{
    const exam=exams.find(x=>x.id===item.id),count=exam?.questions?.length||0;
    return `<div class="resultrow recent-quiz-row"><div class="resultmain"><strong>${esc(item.name)}</strong><small>${count} question${count===1?"":"s"}${item.plannedDate?` · Planned ${esc(item.plannedDate)}`:""} · Opened ${new Date(item.lastOpenedAt).toLocaleString()}</small></div><button class="btn" onclick="openRecentQuiz('${item.id}')">Open</button></div>`;
  },"Open a quiz to build your recent list.");
}
function openRecentQuiz(idValue){
  // Resume only unfinished work. A completed session should start a fresh attempt
  // instead of reopening the locked exam canvas.
  const session=get(K.sessions,[]).find(x=>x.examId===idValue&&!x.examFinished);
  if(session){restoreSession(session.id);return}
  const exam=getExamRecord(idValue);if(!exam)return;
  examId=exam.id;examName=exam.name;questions=cloneData(exam.questions||[]);sections=cloneData(exam.sections||[]);answers=Array(questions.length).fill(null);reviews=new Set();checkedQuestions=new Set();matchOrders={};current=0;seconds=(exam.durationMinutes||settings.defaultDuration||5)*60;quizDurationMinutes=seconds/60;timerState.examSeconds=seconds;timerState.practiceSeconds=5*60;timerState.running=false;examFinished=false;registerRecentQuiz(exam);showView("exam");render();saveSession();
}

function renderTodos() {
  const container = document.getElementById("todoListContainer");
  if(!container) return;
  const todos = get("examflow_todos_v1", []);
  if(!todos.length) {
    container.innerHTML = "<div class='empty'>No todos yet. Add one above!</div>";
    return;
  }
  container.innerHTML = todos.map((t, i) => `
    <div style="display:flex; justify-content:space-between; align-items:center; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: ${t.done ? 'var(--surface2)' : 'var(--surface)'};">
      <div style="display:flex; align-items:center; gap: 10px; ${t.done ? 'text-decoration:line-through; opacity: 0.6;' : ''}">
        <input type="checkbox" ${t.done ? 'checked' : ''} onchange="toggleTodo(${i})" style="accent-color: var(--primary); width:16px; height:16px; cursor:pointer;">
        <div>
          <strong>${esc(t.text)}</strong>
          ${t.deadline ? `<small style="display:block; color:var(--muted); font-size:10px;">Deadline: ${esc(t.deadline)}</small>` : ''}
        </div>
      </div>
      <button class="session-delete" onclick="deleteTodo(${i})">×</button>
    </div>
  `).join("");
}

function addTodo() {
  const input = document.getElementById("todoInput");
  const deadlineInput = document.getElementById("todoDeadline");
  if(!input || !input.value.trim()) return;
  const todos = get("examflow_todos_v1", []);
  todos.push({ text: input.value.trim(), deadline: deadlineInput ? deadlineInput.value : "", done: false });
  put("examflow_todos_v1", todos);
  input.value = "";
  if(deadlineInput) deadlineInput.value = "";
  renderTodos();
}

function toggleTodo(i) {
  const todos = get("examflow_todos_v1", []);
  if(todos[i]) {
    todos[i].done = !todos[i].done;
    put("examflow_todos_v1", todos);
    renderTodos();
  }
}

function deleteTodo(i) {
  const todos = get("examflow_todos_v1", []);
  if(todos[i]) {
    todos.splice(i, 1);
    put("examflow_todos_v1", todos);
    renderTodos();
  }
}

function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}

/* EXAMFLOW_PERSISTENT_BACKUP_START */
const EXAMFLOW_BACKUP_DB="examflow_persistent_backup_v1";
const EXAMFLOW_BACKUP_STORE="app_state";

function backupPayload(){
  const data={};
  Object.values(K).forEach(key=>{
    try{
      const raw=localStorage.getItem(key);
      if(raw!==null)data[key]=JSON.parse(raw);
    }catch(e){}
  });
  try{
    const deadline=localStorage.getItem("examflow_exam_deadline");
    if(deadline!==null)data.examflow_exam_deadline=deadline;
  }catch(e){}
  return data;
}

function openBackupDB(){
  return new Promise((resolve,reject)=>{
    if(!window.indexedDB)return reject(new Error("IndexedDB unavailable"));
    const req=indexedDB.open(EXAMFLOW_BACKUP_DB,1);
    req.onupgradeneeded=()=>{
      if(!req.result.objectStoreNames.contains(EXAMFLOW_BACKUP_STORE)){
        req.result.createObjectStore(EXAMFLOW_BACKUP_STORE);
      }
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}

async function backupToPersistentStorage(){
  try{
    const db=await openBackupDB();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(EXAMFLOW_BACKUP_STORE,"readwrite");
      tx.objectStore(EXAMFLOW_BACKUP_STORE).put({
        savedAt:new Date().toISOString(),
        data:backupPayload()
      },"latest");
      tx.oncomplete=resolve;
      tx.onerror=()=>reject(tx.error);
    });
    db.close();
  }catch(e){}
}

async function restoreFromPersistentStorage(){
  try{
    const db=await openBackupDB();
    const snapshot=await new Promise((resolve,reject)=>{
      const tx=db.transaction(EXAMFLOW_BACKUP_STORE,"readonly");
      const req=tx.objectStore(EXAMFLOW_BACKUP_STORE).get("latest");
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
    });
    db.close();
    if(!snapshot || !snapshot.data)return;

    // Only restore missing keys; never overwrite newer localStorage data.
    Object.entries(snapshot.data).forEach(([key,value])=>{
      if(localStorage.getItem(key)===null){
        try{
          localStorage.setItem(key,typeof value==="string"?value:JSON.stringify(value));
        }catch(e){}
      }
    });

    try{
      if(localStorage.getItem("examflow_exam_deadline")===null &&
         snapshot.data.examflow_exam_deadline!==undefined){
        localStorage.setItem("examflow_exam_deadline",snapshot.data.examflow_exam_deadline);
      }
    }catch(e){}
  }catch(e){}
}

async function requestPersistentStorage(){
  try{
    if(navigator.storage && navigator.storage.persist){
      await navigator.storage.persist();
    }
  }catch(e){}
}
/* EXAMFLOW_PERSISTENT_BACKUP_END */

function loadSettings(){
 const s=Object.assign({theme:"light",defaultMode:"exam",fontFamily:"System Default",colorScheme:"classic",soundEnabled:true,instantFeedback:false,defaultDuration:5,defaultMarks:1,defaultNegative:0},get(K.settings,{}));
 s.defaultDuration=[5,10,15,20,30,45,60].includes(Number(s.defaultDuration))?Number(s.defaultDuration):5;
 return s;
}
function saveSettings(){
  const feedbackToggle=document.getElementById("instantFeedback");
  if(feedbackToggle)settings.instantFeedback=feedbackToggle.checked;
  settings.defaultDuration=[5,10,15,20,30,45,60].includes(Number(document.getElementById("defaultDuration").value))?Number(document.getElementById("defaultDuration").value):5;
  settings.defaultMarks=Number(document.getElementById("defaultMarks").value||1);
  settings.defaultNegative=Number(document.getElementById("defaultNegative").value||0);
  const fs=document.getElementById("fontSelect");if(fs)settings.fontFamily=fs.value;
  const cs=document.getElementById("colorSchemeSelect");if(cs)settings.colorScheme=cs.value;
  put(K.settings,settings);applySettings();
}
function applySettings(){
 settings.defaultDuration=[5,10,15,20,30,45,60].includes(Number(settings.defaultDuration))?Number(settings.defaultDuration):5;
 document.body.classList.toggle("dark",settings.theme==="dark");updateTheme();
 const d=document.getElementById("defaultDuration");if(d)d.value=String(settings.defaultDuration);
 const fs=document.getElementById("fontSelect");if(fs)fs.value=settings.fontFamily||"System Default";
 const schemes=["classic","ocean","forest","sunset","slate"];
 document.body.classList.remove(...schemes.map(x=>`scheme-${x}`));
 const scheme=schemes.includes(settings.colorScheme)?settings.colorScheme:"classic";
 settings.colorScheme=scheme;
 document.body.classList.add(`scheme-${scheme}`);
 const cs=document.getElementById("colorSchemeSelect");if(cs)cs.value=scheme;
 const soundOn=settings.soundEnabled!==false;
 const soundToggle=document.getElementById("soundOnBtn"),soundMute=document.getElementById("soundOffBtn");
 if(soundToggle)soundToggle.classList.toggle("active",soundOn);
 if(soundMute)soundMute.classList.toggle("active",!soundOn);
 let fstr = "'Inter', 'Segoe UI', Arial, sans-serif";
 if(settings.fontFamily==="Serif Elegant") fstr = "'Latin Modern Roman', 'Computer Modern', 'STIX Two Text', 'Times New Roman', serif";
 if(settings.fontFamily==="Modern Rounded") fstr = "'Nunito', 'Quicksand', 'Arial Rounded MT Bold', sans-serif";
 if(settings.fontFamily==="Monospace") fstr = "'Cascadia Code', 'SFMono-Regular', Consolas, monospace";
 if(settings.fontFamily==="Source Serif") fstr = "'Source Serif 4', Georgia, serif";
 if(settings.fontFamily==="Libre Baskerville") fstr = "'Libre Baskerville', Georgia, serif";
 if(settings.fontFamily==="Lora") fstr = "'Lora', Georgia, serif";
 if(settings.fontFamily==="DM Sans") fstr = "'DM Sans', 'Segoe UI', sans-serif";
 if(settings.fontFamily==="Nunito Sans") fstr = "'Nunito Sans', 'Segoe UI', sans-serif";
 if(settings.fontFamily==="IBM Plex Mono") fstr = "'IBM Plex Mono', Consolas, monospace";
 document.body.style.setProperty('--exam-font', fstr);
 mode=settings.defaultMode;updateModeUI()
}
function setTheme(x){settings.theme=x;put(K.settings,settings);applySettings()}
function setSoundEnabled(enabled){settings.soundEnabled=!!enabled;put(K.settings,settings);applySettings();toast(enabled?"Interface sounds on":"Interface sounds muted")}
function setDefaultMode(x){settings.defaultMode=x;put(K.settings,settings);setMode(x)}
function updateTheme(){document.getElementById("lightBtn").classList.toggle("active",settings.theme==="light");document.getElementById("darkBtn").classList.toggle("active",settings.theme==="dark")}
function updateTimerUI(){
 const examEl=document.getElementById("timer");
 const active=mode==="practice"?timerState.practiceSeconds:timerState.examSeconds;
 if(examEl)examEl.textContent=formatGlobalTime(timerState.examSeconds);
 const examCtl=document.getElementById("examTimerControl");
 if(examCtl)examCtl.style.display=mode==="exam"?"flex":"none";
 updateUniversalTimerUI();
}
function formatGlobalTime(sec){
 sec=Math.max(0,Math.floor(Number(sec)||0));
 return `${String(Math.floor(sec/60)).padStart(2,"0")}:${String(sec%60).padStart(2,"0")}`;
}
function startGlobalTimer(){
 timerState.running=true;
 updateTimerUI();
}
function pauseGlobalTimer(){
 timerState.running=false;
 updateTimerUI();
}
function togglePracticeTimer(){
 if(mode!=="practice")return;
 if(timerState.practiceSeconds<=0)timerState.practiceSeconds=5*60;
 timerState.running=!timerState.running;
 updateTimerUI();
 saveSessionSoon();
}
function setPracticeTimer(minutes){
 minutes=Number(minutes);
 if(minutes!==5&&minutes!==10)return;
 timerState.practiceSeconds=minutes*60;
 timerState.running=true;
 mode="practice";
 updateModeUI();
 updateTimerUI();
 saveSessionSoon();
 toast("Practice timer: "+minutes+" minutes");
}
function updateModeUI(){
 document.body.classList.toggle("practice-active",mode==="practice");
 document.getElementById("examMode").classList.toggle("active",mode==="exam");
 document.getElementById("practiceMode").classList.toggle("active",mode==="practice");
 document.getElementById("defaultExam").classList.toggle("active",settings.defaultMode==="exam");
 document.getElementById("defaultPractice").classList.toggle("active",settings.defaultMode==="practice");
 if(document.getElementById("modeBadge"))document.getElementById("modeBadge").textContent=mode==="exam"?"EXAM MODE":"PRACTICE MODE";
 updateTimerUI();
}
function setMode(x){
 mode=x==="practice"?"practice":"exam";
 if(mode==="practice"){
   if(!Number.isFinite(timerState.practiceSeconds)||timerState.practiceSeconds<=0)timerState.practiceSeconds=5*60;
 }else{
   const maxExam=Math.min(10,Math.max(1,quizDurationMinutes||settings.defaultDuration||5))*60;
   if(!Number.isFinite(timerState.examSeconds)||timerState.examSeconds<=0)timerState.examSeconds=maxExam;
 }
 timerState.running=true;
 updateModeUI();
 updateTimerUI();
 render();
 saveSessionSoon();
}

function normalize(q,defaults={}){
 const text=q.question??q.text??"";
 const type=String(q.type??q.questionType??"mcq").toLowerCase().replace(/[\s-]+/g,"_");
 const explanation=q.explanation??q.reason??q.solution??q.rationale??q.hint??"";
 const marks=Number(q.marks??q.points??defaults.marks??settings.defaultMarks??1);
 const negativeMarks=Number(q.negativeMarks??q.negative??defaults.negativeMarks??settings.defaultNegative??0);
 const section=q.section??q.category??q.topic??defaults.name??"General";

 if(typeof text!=="string")throw Error("Each question needs question/text.");

 const allowed=["mcq","single_choice","true_false","fill_blank","fill_in_the_blank","match","matching","drag_drop","drag_and_drop","image","image_choice","ordering"];
 if(!allowed.includes(type))throw Error(`Unsupported question type: ${type}`);

 if(type==="fill_blank"||type==="fill_in_the_blank"){
   const accepted=q.acceptedAnswers??q.accepted??q.answers??q.answer;
   const vals=Array.isArray(accepted)?accepted.map(String):[String(accepted??"")];
   if(!vals[0])throw Error("Fill-in-the-blank needs answer/acceptedAnswers.");
   return {type:"fill_blank",text,options:[],answer:vals[0],acceptedAnswers:vals,explanation,marks,negativeMarks,section,image:q.image??q.picture??""};
 }

 if(type==="match"||type==="matching"||type==="drag_drop"||type==="drag_and_drop"){
   const pairs=q.pairs??q.matches??q.matching;
   if(!Array.isArray(pairs)||!pairs.length)throw Error("Matching questions need a pairs array.");
   const normalizedPairs=pairs.map((p,i)=>{
     if(typeof p==="object")return {left:String(p.left??p.question??p.prompt??""),right:String(p.right??p.answer??p.match??"")};
     if(Array.isArray(p))return {left:String(p[0]??""),right:String(p[1]??"")};
     throw Error(`Invalid matching pair ${i+1}.`);
   });
   if(normalizedPairs.some(p=>!p.left||!p.right))throw Error("Every matching pair needs left and right values.");
   return {type:type.includes("drag")?"drag_drop":"match",text,options:[],answer:normalizedPairs.map(p=>p.right),pairs:normalizedPairs,explanation,marks,negativeMarks,section,image:q.image??q.picture??""};
 }

 if(type==="ordering"){
   const items=q.items??q.options??q.choices;
   const raw=q.answer??q.correct;
   if(!Array.isArray(items)||items.length<2)throw Error("Ordering questions need an items array.");
   const order=Array.isArray(raw)?raw.map(String):[];
   if(order.length!==items.length)throw Error("Ordering answer must contain every item in order.");
   return {type:"ordering",text,options:items.map(String),answer:order,explanation,marks,negativeMarks,section,image:q.image??q.picture??""};
 }

 const options=q.options??q.choices;
 if(type==="true_false"){
   const opts=["True","False"];
   const raw=q.answer??q.correct;
   const answer=String(raw).toLowerCase().startsWith("t")?"A":"B";
   return {type:"true_false",text,options:opts,answer,explanation,marks,negativeMarks,section,image:q.image??q.picture??""};
 }
 if(!Array.isArray(options)||options.length<2)throw Error("Each choice question needs at least 2 options/choices.");
 const raw=q.answer??q.correct;
 let answer=null;
 if(typeof raw==="number"&&raw>=0&&raw<options.length)answer=String.fromCharCode(65+raw);
 else if(typeof raw==="string"){
   const s=raw.trim(),letter=s.match(/^([A-Z])$/i);
   if(letter){let n=letter[1].toUpperCase().charCodeAt(0)-65;if(n<options.length)answer=letter[1].toUpperCase()}
   if(!answer){let i=options.findIndex(x=>String(x).trim()===s);if(i>=0)answer=String.fromCharCode(65+i)}
 }
 if(!answer)throw Error("Could not resolve answer for: "+text.slice(0,55));
 return {type:type==="image_choice"?"image_choice":type==="image"?"image":"mcq",text,options:options.map(String),answer,explanation,marks,negativeMarks,section,image:q.image??q.picture??""};
}

function parseQuizInput(raw){
  let text=String(raw??"").trim();
  if(!text)throw Error("Paste quiz JSON first.");

  // Accept ```json ... ```, ``` ... ```, or plain pasted JSON.
  text=text.replace(/^\uFEFF/,"").trim();
  text=text.replace(/^```(?:json|JSON|javascript|js)?\s*/,"").replace(/\s*```$/,"").trim();

  // If explanatory text was copied around the JSON, isolate the first complete
  // object/array. This is deliberately conservative and only runs if direct
  // JSON.parse fails.
  const direct=()=>{
    try{return JSON.parse(text)}catch(e){return null}
  };
  let parsed=direct();
  if(parsed!==null)return parsed;

  let candidate=text;
  const firstObj=text.indexOf("{"),firstArr=text.indexOf("[");
  let start=-1;
  if(firstObj<0)start=firstArr;
  else if(firstArr<0)start=firstObj;
  else start=Math.min(firstObj,firstArr);
  if(start>0)candidate=text.slice(start);

  // Remove JS-style comments outside strings and trailing commas.
  candidate=candidate
    .replace(/\/\*[\s\S]*?\*\//g,"")
    .replace(/(^|[^:\\])\/\/[^\r\n]*/g,"$1")
    .replace(/,\s*([}\]])/g,"$1");

  // Common copy/paste issue: smart quotes.
  candidate=candidate
    .replace(/[\u201C\u201D]/g,'"')
    .replace(/[\u2018\u2019]/g,"'");

  try{return JSON.parse(candidate)}catch(e){}

  // Allow unquoted object keys: {question:"...", options:[...]}.
  candidate=candidate.replace(/([{,]\s*)([A-Za-z_$][\w$-]*)(\s*:)/g,"$1\"$2\"$3");

  // Allow simple single-quoted JSON strings when the content contains no
  // unescaped apostrophe. This is only a fallback after real JSON failed.
  candidate=candidate.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g,(m,s)=>{
    return '"'+s.replace(/"/g,'\\"')+'"';
  });

  try{return JSON.parse(candidate)}catch(e){
    // Final recovery: if surrounding plain text remains, isolate the last
    // closing brace/bracket and retry.
    const end=Math.max(candidate.lastIndexOf("}"),candidate.lastIndexOf("]"));
    if(end>=0){
      const clipped=candidate.slice(0,end+1);
      try{return JSON.parse(clipped)}catch(_){}
    }
    throw Error("Quiz JSON could not be repaired. Paste the JSON, optionally inside ```json ... ```, and the quiz will try to recover common formatting errors.");
  }
}

function parseQuiz(data){
 let qs=[],secs=[],name="Imported CBQ",duration=Number(settings.defaultDuration||5);
 if(Array.isArray(data)){
   qs=data.map(q=>normalize(q));
 }else if(data&&Array.isArray(data.sections)){
   name=data.name||name;
   data.sections.forEach(s=>{
     if(!Array.isArray(s.questions))throw Error("A section is missing its questions array.");
     s.questions.forEach(q=>qs.push(normalize(q,s)));
     if(s.timeMinutes!=null)duration+=Number(s.timeMinutes||0);
     secs.push({name:s.name||"General",timeMinutes:s.timeMinutes,marks:s.marks,negativeMarks:s.negativeMarks});
   });
   if(data.timeMinutes!=null)duration=Number(data.timeMinutes);
 }else throw Error("Use a flat JSON array or an object containing sections.");
 if(Array.isArray(data)&&data.timeMinutes!=null)duration=Number(data.timeMinutes);
 if(!qs.length)throw Error("No questions found.");
 return {name,questions:qs,sections:secs,durationMinutes:Math.min(10,Math.max(1,duration))};
}
function openImporter(){document.getElementById("importer").classList.add("show");document.getElementById("jsonInput").value="";document.getElementById("jsonStatus").textContent="";setTimeout(()=>document.getElementById("jsonInput").focus(),40)}
function closeImporter(){document.getElementById("importer").classList.remove("show")}
function readFile(e){let f=e.target.files[0];if(!f)return;let r=new FileReader();r.onload=()=>document.getElementById("jsonInput").value=r.result;r.readAsText(f)}
function loadQuiz(){
 try{
   const parsed=parseQuiz(parseQuizInput(document.getElementById("jsonInput").value));
   questions=prepareShuffledQuiz(parsed.questions);sections=parsed.sections;examName=parsed.name;examId=id();
   answers=Array(questions.length).fill(null);reviews=new Set();checkedQuestions=new Set();matchOrders={};current=0;
   quizDurationMinutes=Math.min(10,Math.max(1,parsed.durationMinutes||settings.defaultDuration||5));seconds=quizDurationMinutes*60;timerState.examSeconds=seconds;timerState.practiceSeconds=5*60;timerState.running=false;sessionId=null;examFinished=false;
   if(document.getElementById("examTitle"))document.getElementById("examTitle").textContent=examName;document.getElementById("headerQuizName").textContent=examName;
   if(document.getElementById("examMeta"))document.getElementById("examMeta").textContent=`${questions.length} questions · ${quizDurationMinutes} min · scoring from JSON/settings`;
   registerActiveExam();closeImporter();showView("exam");render();saveSession();toast(`Loaded ${questions.length} questions ✓`);
 }catch(e){document.getElementById("jsonStatus").className="status err";document.getElementById("jsonStatus").textContent="✕ "+e.message}
}


function protectQuizCodeAndMath(root){
  if(!root)return;
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
  nodes.forEach(node=>{
    const parent=node.parentElement;
    if(!parent||parent.closest("pre,code,.katex,.katex-display"))return;
    const text=node.nodeValue;
    if(!text||!text.trim())return;

    let out=text;
    // Fenced code: ```language\n...\n```
    out=out.replace(/```([A-Za-z0-9_+-]*)[ \t]*\n?([\s\S]*?)```/g,
      (_,lang,code)=>`<pre class="quiz-code-block"><code>${esc(code)}</code></pre>`);
    // Inline code: `...`
    out=out.replace(/`([^`\n]+)`/g,
      (_,code)=>`<code class="quiz-inline-code">${esc(code)}</code>`);

    if(out!==text){
      const holder=document.createElement("span");
      holder.innerHTML=out;
      const frag=document.createDocumentFragment();
      while(holder.firstChild)frag.appendChild(holder.firstChild);
      node.parentNode.replaceChild(frag,node);
    }
  });
}
function formatExplanationText(text){
  if(text==null)return "";
  return String(text).trim();
}
function renderAllQuizMath(root=document){
  if(!root||typeof renderMathInElement!=="function")return;
  protectQuizCodeAndMath(root);
  const cfg={
    delimiters:[
      {left:"$$",right:"$$",display:true},
      {left:"\\[",right:"\\]",display:true},
      {left:"$",right:"$",display:false},
      {left:"\\(",right:"\\)",display:false}
    ],
    throwOnError:false,strict:false,trust:false
  };
  try{renderMathInElement(root,cfg)}catch(e){}
}

function renderMath(){
  renderAllQuizMath(document.getElementById("examView")||document);
}

const examflowMathObserver=new MutationObserver(mutations=>{
  for(const m of mutations){
    if(m.addedNodes&&m.addedNodes.length){
      m.addedNodes.forEach(n=>{if(n.nodeType===1)renderAllQuizMath(n)});
    }
  }
});
document.addEventListener("DOMContentLoaded",()=>{
  const root=document.getElementById("examView")||document.body;
  examflowMathObserver.observe(root,{childList:true,subtree:true});
});

const __examflowRenderWithMath=render;
render=function(){
  __examflowRenderWithMath();
  renderAllQuizMath(document.getElementById("examView")||document);
};

function renderQuestionImage(q){
 const old=document.getElementById("questionImage");
 if(old)old.remove();
 if(!q.image)return;
 const img=document.createElement("img");
 img.id="questionImage";img.src=q.image;img.alt="Question image";
 img.style.cssText="display:block;max-width:100%;max-height:360px;object-fit:contain;margin:10px auto 18px;border-radius:10px;border:1px solid var(--line);";
 const qt=document.getElementById("questionText");
 qt.parentNode.insertBefore(img,qt.nextSibling);
}
function renderSpecialQuestion(q,opts){
 opts.innerHTML="";
 if(q.type==="fill_blank"){
   const wrap=document.createElement("div");
   wrap.className="special-answer";
   const input=document.createElement("input");
   input.className="fill-answer";input.placeholder="Type your answer…";input.autocomplete="off";
   input.value=answers[current]||"";
   input.oninput=()=>{answers[current]=input.value;checkedQuestions.delete(current);saveSessionSoon()};
   wrap.appendChild(input);opts.appendChild(wrap);
 }else if(q.type==="match"||q.type==="drag_drop"){
   const chosen=answers[current]||[];
   const rights=q.pairs.map(p=>p.right);
   if(!matchOrders[current]){
     const indexed=rights.map((right,i)=>({right,i}));
     // Fisher-Yates once per question; the resulting order is retained.
     for(let i=indexed.length-1;i>0;i--){
       const j=Math.floor(Math.random()*(i+1));
       [indexed[i],indexed[j]]=[indexed[j],indexed[i]];
     }
     matchOrders[current]=indexed.map(x=>x.right);
     saveSessionSoon();
   }
   const shuffled=matchOrders[current];
   const grid=document.createElement("div");grid.className="matching-grid";
   q.pairs.forEach((pair,i)=>{
     const row=document.createElement("div");row.className="match-row";
     const left=document.createElement("div");left.className="match-left";
     left.innerHTML=esc(pair.left);

     const wrap=document.createElement("div");wrap.className="match-choice";
     const selected=chosen[i]||"";
     const trigger=document.createElement("button");
     trigger.type="button";trigger.className="match-trigger";
     trigger.innerHTML=selected?`<span class="match-selected">${esc(selected)}</span><span class="match-chevron">⌄</span>`:`<span class="match-placeholder">Choose match…</span><span class="match-chevron">⌄</span>`;

     const menu=document.createElement("div");menu.className="match-menu";
     menu.innerHTML=shuffled.map((x,k)=>`<button type="button" class="match-menu-item${String(x)===String(selected)?" selected":""}" data-value="${esc(x)}"><span>${String.fromCharCode(65+k)}</span><span class="match-menu-text">${esc(x)}</span></button>`).join("");
     menu.querySelectorAll(".match-menu-item").forEach(item=>{
       item.onclick=()=>{
         const value=item.getAttribute("data-value")||"";
         const a=Array.isArray(answers[current])?[...answers[current]]:Array(q.pairs.length).fill("");
         a[i]=value;answers[current]=a;checkedQuestions.delete(current);saveSessionSoon();render();
       };
     });
     trigger.onclick=e=>{
       e.stopPropagation();
       document.querySelectorAll(".match-choice.open").forEach(x=>{if(x!==wrap)x.classList.remove("open")});
       wrap.classList.toggle("open");
     };
     wrap.append(trigger,menu);

     if(checkedQuestions.has(current)){
       const ok=String(chosen[i]??"").trim().toLowerCase()===String(pair.right??"").trim().toLowerCase();
       row.classList.add(ok?"match-correct":"match-wrong");
       const label=document.createElement("div");label.className="match-result-label";label.textContent=ok?"✓ Correct":"✕ Incorrect";
       row.append(left,wrap,label);
     }else row.append(left,wrap);
     grid.appendChild(row);
   });
   opts.appendChild(grid);
   renderAllQuizMath(grid);
   if(q.type==="drag_drop"){
     const hint=document.createElement("div");hint.className="drag-hint";hint.textContent="↕ Match each item using the selectors.";opts.appendChild(hint);
   }
   if(mode==="practice"){
     const check=document.createElement("button");
     check.type="button";check.className="btn primary match-check-btn";
     check.textContent="✓ Check matches";
     check.onclick=()=>{if(!answerIsPresent(answers[current],q)){toast("Complete every match first");return}checkedQuestions.add(current);render();saveSessionSoon()};
     opts.appendChild(check);
   }
 }else if(q.type==="ordering"){
   const currentOrder=Array.isArray(answers[current])&&answers[current].length?answers[current]:[...q.options];
   const list=document.createElement("div");list.className="ordering-list";
   currentOrder.forEach((item,i)=>{
     const b=document.createElement("button");b.type="button";b.className="order-item";b.draggable=true;b.textContent=`${i+1}. ${item}`;
     b.ondragstart=e=>e.dataTransfer.setData("text/plain",String(i));
     b.ondragover=e=>e.preventDefault();
     b.ondrop=e=>{const from=Number(e.dataTransfer.getData("text/plain"));const arr=[...currentOrder];const [m]=arr.splice(from,1);arr.splice(i,0,m);answers[current]=arr;checkedQuestions.delete(current);render();saveSessionSoon()};
     list.appendChild(b);
   });
   opts.appendChild(list);
 }else{
   q.options.forEach((text,i)=>{
     const letter=String.fromCharCode(65+i),b=document.createElement("button");
     b.className="option"+(answers[current]===letter?" selected":"");
     b.innerHTML=`<span class="letter">${letter}</span><span class="option-text">${esc(text)}</span>`;
     b.onclick=()=>choose(letter);opts.appendChild(b);
   });
 }
}
function isQuestionCorrect(q,ans){
 if(q.type==="fill_blank"){
   return q.acceptedAnswers.some(x=>String(x).trim().toLowerCase()===String(ans??"").trim().toLowerCase());
 }
 if(q.type==="match"||q.type==="drag_drop"){
   if(!Array.isArray(ans)||ans.length!==q.pairs.length)return false;
   return q.pairs.every((pair,i)=>{
     const selected=String(ans[i]??"").trim().toLowerCase();
     const expected=String(pair.right??"").trim().toLowerCase();
     return selected!=="" && selected===expected;
   });
 }
 if(q.type==="ordering"){
   return Array.isArray(ans)&&ans.length===q.answer.length&&q.answer.every((x,i)=>String(ans[i])===String(x));
 }
 return ans===q.answer;
}
function answerIsPresent(ans,q){
 if(ans==null)return false;
 if(q.type==="fill_blank")return String(ans).trim()!=="";
 if(q.type==="match"||q.type==="drag_drop")return Array.isArray(ans)&&ans.length===q.pairs.length&&ans.every(x=>String(x??"").trim()!=="");
 if(q.type==="ordering")return Array.isArray(ans)&&ans.length===q.answer.length&&ans.every(x=>String(x).trim()!=="");
 return !!ans;
}

/* Fast keyboard workflow */
let examflowKeyboardShortcuts={busy:false};
function isTypingTarget(el){
  if(!el)return false;
  const tag=(el.tagName||"").toLowerCase();
  return tag==="input"||tag==="textarea"||tag==="select"||el.isContentEditable;
}
async function examflowCtrlEnter(){
  const importer=document.getElementById("importer");
  const homeInput=document.getElementById("homeJson");
  if(!importer?.classList.contains("show") && document.getElementById("homeView")?.classList.contains("active") && homeInput?.value.trim()){
    startHomeQuiz();
    return;
  }
  const input=document.getElementById("jsonInput");
  if(importer?.classList.contains("show") && input){
    // Ctrl+Enter starts the JSON already pasted into the importer.
    if(examflowKeyboardShortcuts.busy)return;
    examflowKeyboardShortcuts.busy=true;
    try{
      const before=input.value.trim();
      if(!before){
        try{await pasteFromClipboard("jsonInput","jsonStatus","importPasteBtn")}catch(e){}
      }
      if(input.value.trim())loadQuiz();else toast("Paste quiz JSON first");
    }finally{examflowKeyboardShortcuts.busy=false}
    return;
  }
  if(document.getElementById("homeView")?.classList.contains("active")){
    openImporter();
    setTimeout(()=>examflowCtrlEnter(),60);
  }
}
function examflowToggleThemeFast(){
  setTheme(settings.theme==="dark"?"light":"dark");
  toast(settings.theme==="dark"?"Dark mode ✓":"Light mode ✓");
}
function examflowSelectOptionByNumber(n){
  if(!questions.length||!document.getElementById("examView")?.classList.contains("active"))return;
  const q=questions[current];
  if(!Array.isArray(q.options)||n<1||n>q.options.length)return;
  if(q.type==="fill_blank"||q.type==="match"||q.type==="drag_drop"||q.type==="ordering")return;
  choose(String.fromCharCode(64+n));
}
function examflowKeyboardHandler(e){
  const key=e.key, lower=key.toLowerCase(), typing=isTypingTarget(e.target);

  if(e.key==="Escape"){
    closeImporter();closeSubmit();closeSessions();
    if(typeof closeCBQModal === "function") closeCBQModal();
    const drawer=document.getElementById("examProgressDrawer");
    if(drawer?.classList.contains("open"))toggleQuestionProgress();
    if(document.activeElement) document.activeElement.blur();
    return;
  }

  // Confirm submission from the open dialog without affecting answer checking.
  if(e.key==="Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && document.getElementById("submitModal")?.classList.contains("show")){
    e.preventDefault();
    finishTest();
    return;
  }

  // Ctrl/Cmd+Enter is the single intentional exception to the browser guard.
  if((e.ctrlKey||e.metaKey)&&e.key==="Enter" && (document.getElementById("importer")?.classList.contains("show") || document.getElementById("homeView")?.classList.contains("active"))){
    e.preventDefault();
    examflowCtrlEnter();
    return;
  }

  // Never capture browser-reserved Ctrl/Cmd shortcuts such as Save or Open.
  if(e.ctrlKey||e.metaKey)return;

  // Never hijack normal text editing.
  if(typing)return;

  // Alt+number navigation stays separate from quiz answer keys and browser tabs.
  if(e.altKey && !e.shiftKey && /^[1-5]$/.test(e.key)){
    e.preventDefault();
    const page=["home","exam","dashboard","planner","settings"][Number(e.key)-1];
    if(page)showView(page);
    return;
  }
  if(e.altKey && lower==="m"){e.preventDefault();toggleMobileNav();return}
  if(e.altKey && lower==="i"){e.preventDefault();openImporter();return}
  if(e.altKey && lower==="x"){e.preventDefault();exportData();return}
  if(e.altKey && lower==="s"){
    if(document.getElementById("examView")?.classList.contains("active")){e.preventDefault();saveSession();toast("Session saved ✓")}
    return;
  }

  if(lower==="t"){e.preventDefault();toggleUniversalTimer();return}
  if(e.shiftKey && !e.altKey && lower==="l"){e.preventDefault();setTheme("light");return}
  if(e.shiftKey && !e.altKey && lower==="d"){e.preventDefault();setTheme("dark");return}

  const resultsActive=document.getElementById("testResultsView")?.classList.contains("active");
  if(resultsActive){
    if(e.key==="ArrowRight"||e.key==="ArrowLeft"){
      e.preventDefault();
      moveResultQuestion(e.key==="ArrowRight"?1:-1);
      return;
    }
    if(lower==="r"){e.preventDefault();retakeLastTest();return}
    if(lower==="s"){e.preventDefault();saveResultCopy();return}
    if(lower==="c"){e.preventDefault();showView("home");return}
    return;
  }

  const examActive=document.getElementById("examView")?.classList.contains("active");



  if(lower==="k"){e.preventDefault();examflowToggleThemeFast();return}
  if(lower==="h"){e.preventDefault();showView("home");return}
  if(!examActive)return;

  if(e.shiftKey && lower==="p"){e.preventDefault();setMode("practice");return}
  if(e.shiftKey && lower==="e"){e.preventDefault();setMode("exam");return}
  if(e.shiftKey && lower==="g"){e.preventDefault();redirectQuestionToChatGPT();return}
  if(e.shiftKey && lower==="q"){e.preventDefault();toggleQuestionProgress();return}
  if(e.shiftKey && lower==="t"){e.preventDefault();toggleUniversalTimer();return}
  if(e.shiftKey && lower==="s"){e.preventDefault();submitExam();return}

  if(lower==="e"){e.preventDefault();setMode("exam");return}
  if(lower==="m"){e.preventDefault();setMode("practice");return}
  if(lower==="g"){e.preventDefault();redirectQuestionToChatGPT();return}

  if(e.key==="ArrowRight" || lower==="n"){
    e.preventDefault();
    nextQuestion();
    return;
  }
  if(e.key==="ArrowLeft" || lower==="b"){
    e.preventDefault();
    previousQuestion();
    return;
  }
  if(e.key==="Enter"){e.preventDefault();checkCurrentAnswer();return}
  if(lower==="v" && mode==="practice"){e.preventDefault();viewPracticeAnswer();return}
  if(lower==="p"){e.preventDefault();toggleQuestionProgress();return}
  if(lower==="r"){e.preventDefault();toggleReview();return}
  if(e.key==="Delete" || e.key==="Backspace"){e.preventDefault();clearAnswer();return}
  if(/^[1-4]$/.test(e.key)){e.preventDefault();examflowSelectOptionByNumber(Number(e.key));return}
}

/* Single keyboard router: all app shortcuts live here. */
document.addEventListener("keydown",examflowKeyboardHandler,true);


/* Lightweight click pulse: visual confirmation for every interactive button */
document.addEventListener("pointerdown",e=>{
  const b=e.target.closest("button,.btn,.modebtn,.preset-btn,.bookmark,.qbtn");
  if(!b||b.disabled)return;
  if(b.id!=="soundOffBtn")playButtonSound();
  b.classList.remove("click-pulse");
  void b.offsetWidth;
  b.classList.add("click-pulse");
  setTimeout(()=>b.classList.remove("click-pulse"),180);
});

function copyBeginnerSchema(){
  const source=document.getElementById("beginnerSchema");
  if(!source)return;
  const schema=source.value||source.textContent||"";
  const text=`Create a Concept Breakdown Quiz (CBQ) about: [TOPIC]

What a CBQ means:
A CBQ breaks one difficult topic into a sequence of small, connected questions. Each question should build the reasoning needed for the next step, moving from core ideas to application and finally to a clear solution. Do not make a list of unrelated recall questions.

Your task:
- Replace [TOPIC] with the topic or source material I provide.
- Create a coherent quiz that tests understanding and step-by-step reasoning.
- Include useful explanations for every question.
- Use the question types that best fit the topic: mcq, true_false, fill_blank, match, drag_drop, ordering, or image_choice.
- Give every question a correct answer and marks. Use negativeMarks only when appropriate.
- Keep all question and answer text inside the JSON values.

Math and LaTeX:
- Use inline LaTeX such as $E=mc^2$ inside JSON strings when helpful.
- Use display LaTeX such as $$\\int_0^1 x^2 dx$$ when a separate equation is needed.
- ExamFlow renders this math with KaTeX, so keep LaTeX valid and do not use HTML for equations.
- Escape backslashes correctly for JSON strings.

Output rules:
- Return only valid JSON. Do not return Markdown fences, commentary, or headings outside the JSON.
- Follow the complete ExamFlow schema below.
- Make the JSON directly usable by pasting it into ExamFlow's CBQ loader.

ExamFlow CBQ schema:
${schema}`;
  const done=()=>toast("AI CBQ prompt and schema copied ✓");
  if(navigator.clipboard?.writeText){
    navigator.clipboard.writeText(text).then(done).catch(()=>{
      const ta=document.createElement("textarea");
      ta.value=text;document.body.appendChild(ta);ta.select();
      try{document.execCommand("copy");done()}catch(e){toast("Copy failed")}
      ta.remove();
    });
  }else{
    const ta=document.createElement("textarea");
    ta.value=text;document.body.appendChild(ta);ta.select();
    try{document.execCommand("copy");done()}catch(e){toast("Copy failed")}
    ta.remove();
  }
}

function render(){
 updateModeUI();
 if(!questions.length){
   document.getElementById("currentLabel").textContent="0";document.getElementById("totalLabel").textContent="0";
   document.getElementById("questionText").textContent="Paste a quiz JSON to start.";
   document.getElementById("options").innerHTML="";document.getElementById("qgrid").innerHTML="";
   document.getElementById("progressText").textContent="0 / 0";document.getElementById("progressBar").style.width="0%";return;
 }
 const q=questions[current],count=answers.filter(Boolean).length;
 const apExisting=document.getElementById("practiceAnswerPanel");
 if(apExisting && apExisting.dataset.question!==String(current))apExisting.remove();
 document.getElementById("currentLabel").textContent=current+1;document.getElementById("totalLabel").textContent=questions.length;
 document.getElementById("questionText").innerHTML=esc(q.text||"");
 renderQuestionImage(q);
 const opts=document.getElementById("options");opts.innerHTML="";
 renderSpecialQuestion(q,opts);
 renderMath();
 renderAllQuizMath(document.getElementById("examView"));
 renderAllQuizMath(opts);
 const fb=document.getElementById("feedback");
 const ex=document.getElementById("explanation");
 const ap=document.getElementById("practiceAnswerPanel");
 if(ap && !checkedQuestions.has(current))ap.style.display="none";
 if(mode==="practice"&&answers[current]&&checkedQuestions.has(current)){
   const correct=isQuestionCorrect(q,answers[current]);
   fb.textContent=correct?"✓ Correct":"✕ Incorrect — review the concept";
   fb.style.color=correct?"var(--good)":"var(--bad)";
   if(q.explanation){
     ex.style.display="block";
     ex.innerHTML="<strong>💡 Explanation</strong><div class='explanation-content' style='white-space:pre-wrap;'>"+esc(formatExplanationText(q.explanation))+"</div>";
     renderAllQuizMath(ex);
   }else ex.style.display="none";
 }else{fb.textContent="";ex.style.display="none";}
 document.getElementById("bookmark").textContent=reviews.has(current)?"★ Review":"☆ Review";document.getElementById("bookmark").classList.toggle("saved",reviews.has(current));
 document.getElementById("prevBtn").disabled=current===0;document.getElementById("nextBtn").textContent=current===questions.length-1?"Finish":"Next →";
 document.getElementById("answeredCount").textContent=count;document.getElementById("reviewCount").textContent=reviews.size;
 document.getElementById("progressText").textContent=`${count} / ${questions.length}`;document.getElementById("progressBar").style.width=(count/questions.length*100)+"%";
 const grid=document.getElementById("qgrid");grid.innerHTML="";
 questions.forEach((_,i)=>{let b=document.createElement("button");b.className="qbtn"+(i===current?" current":"")+(answerIsPresent(answers[i],questions[i])?" answered":"")+(reviews.has(i)?" review":"");b.textContent=i+1;b.onclick=()=>{current=i;render();saveSessionSoon()};grid.appendChild(b)});
 document.getElementById("options").querySelectorAll("button,input,select").forEach(el=>el.disabled=examFinished);
 ["prevBtn","viewAnswerBtn","nextBtn","bookmark"].forEach(id=>{const el=document.getElementById(id);if(el)el.disabled=examFinished});
 document.getElementById("questionText").classList.toggle("exam-finished",examFinished);
}
function choose(letter){if(examFinished)return;answers[current]=letter;checkedQuestions.delete(current);render();renderQuestionProgress();saveSessionSoon()}
function clearAnswer(){if(examFinished)return;answers[current]=null;checkedQuestions.delete(current);render();saveSessionSoon()}
function toggleReview(){if(examFinished)return;reviews.has(current)?reviews.delete(current):reviews.add(current);render();renderQuestionProgress();saveSessionSoon()}
function nextQuestion(){if(current<questions.length-1){current++;render();if(!examFinished)saveSessionSoon()}else if(!examFinished)submitExam()}
function previousQuestion(){if(current>0){current--;render();if(!examFinished)saveSessionSoon()}}
function submitExam(){
 if(examFinished)return;
 if(!questions.length){toast("Load a quiz first");return}
 const unanswered=answers.filter(x=>!x).length;
 document.getElementById("submitText").textContent=unanswered?`You have ${unanswered} unanswered question${unanswered>1?"s":""}. Submit anyway?`:"All questions are answered. Submit and save your result?";
 document.getElementById("submitModal").classList.add("show")
}
function closeSubmit(){document.getElementById("submitModal").classList.remove("show")}
function finishTest(automatic=false){
 if(examFinished)return;
 examFinished=true;timerState.running=false;closeSubmit();render();
 const r=saveResult();saveSession();openDetailedResults(r);toast(automatic?"Time is up. Exam submitted.":`Result saved · ${r.percent}% ✓`)
}

function saveSession(){
 if(!questions.length)return;
 const sessions=get(K.sessions,[]),now=new Date().toISOString(),sid=sessionId||id();sessionId=sid;
 const item={id:sid,examId:examId||sid,name:examName,questions,answers,reviews:[...reviews],checkedQuestions:[...checkedQuestions],matchOrders,current,seconds,quizDurationMinutes,mode,sections,examFinished,examTimerSeconds:timerState.examSeconds,practiceTimerSeconds:timerState.practiceSeconds,practiceTimerRunning:timerState.running,updatedAt:now};
 const old=sessions.find(x=>x.id===sid);if(old)Object.assign(old,item);else sessions.unshift(item);
 put(K.sessions,sessions);renderSessions()
}
let saveTimer;function saveSessionSoon(){clearTimeout(saveTimer);saveTimer=setTimeout(saveSession,120)}
function renderSessions(){
 const el=document.getElementById("sessionList"),ss=get(K.sessions,[]);
 el.innerHTML=ss.length?ss.slice(0,20).map(s=>`<div class="session-item"><button class="session-load" onclick="restoreSession('${s.id}')" title="${esc(s.name)}">${esc(s.name)} · ${s.answers.filter(Boolean).length}/${s.questions.length}</button><button class="session-delete" onclick="deleteSession('${s.id}')">×</button></div>`).join(""):'<div class="empty">No saved sessions.</div>';
}
function restoreSession(sid){
 const s=get(K.sessions,[]).find(x=>x.id===sid);if(!s)return;
 sessionId=s.id;examId=s.examId||s.id;examName=s.name;questions=s.questions;answers=s.answers||Array(questions.length).fill(null);reviews=new Set(s.reviews||[]);checkedQuestions=new Set(s.checkedQuestions||[]);matchOrders=s.matchOrders||{};current=Math.min(s.current||0,questions.length-1);seconds=s.seconds===0?0:Math.min(10*60,Math.max(1,s.seconds||5*60));quizDurationMinutes=Math.min(10,Math.max(1,s.quizDurationMinutes||Math.ceil(Math.max(seconds,1)/60)));timerState.examSeconds=Number.isFinite(s.examTimerSeconds)?s.examTimerSeconds:seconds;timerState.practiceSeconds=s.practiceTimerSeconds||5*60;timerState.running=!!s.practiceTimerRunning;examFinished=!!s.examFinished;mode=s.mode||settings.defaultMode;sections=s.sections||[];registerActiveExam();
 if(document.getElementById("examTitle"))document.getElementById("examTitle").textContent=examName;document.getElementById("headerQuizName").textContent=examName;showView("exam");render();toast("Session restored ✓")
}
function deleteSession(sid){put(K.sessions,get(K.sessions,[]).filter(x=>x.id!==sid));renderSessions();renderDashboard();renderHome();}


async function redirectQuestionToChatGPT(){
 const q=questions[current];if(!q){toast("No question loaded");return}
 const question=q.text||"";
 let source=`Question: ${question}`;
 if(Array.isArray(q.options)&&q.options.length)
   source+=`\nOptions: ${q.options.map((x,i)=>`${String.fromCharCode(65+i)}. ${x}`).join(" | ")}`;
 if(q.answer!==undefined)source+=`\nAnswer: ${typeof q.answer==="string"?q.answer:JSON.stringify(q.answer)}`;
 if(q.explanation)source+=`\nExplanation: ${q.explanation}`;
 if(Array.isArray(q.pairs)&&q.pairs.length)
   source+=`\nPairs: ${q.pairs.map(p=>`${p.left} → ${p.right}`).join(" | ")}`;

 const prompt=`Create a Concept Breakdown Quiz (CBQ) for the question below.

WHAT IS A CBQ:
A CBQ is a sequence of step-by-step questions that breaks the original problem into smaller conceptual reasoning steps. It should guide the learner from basic understanding toward the original question, rather than simply asking recall questions or giving the answer. Create exactly 5 progressively deeper CBQs that help the learner understand and solve the original question.

REQUIREMENTS:
- Create exactly 5 CBQ questions.
- Make them progressively more challenging.
- Follow the reasoning path needed to solve the original question.
- Do not simply repeat the original question.
- Each CBQ should help establish a concept or reasoning step needed for the next one.
- Use the same subject terminology as the original question.
- Include explanations for each CBQ.
- Use exactly 2 options for MCQs by default.
- Put mathematical expressions in $...$ or $$...$$.
- Return ONLY a JSON codeblock. Do not return prose outside the codeblock.
- The JSON must be valid JSON.

USE THIS CBQ JSON SCHEMA:
{
  "name": "CBQ — <topic>",
  "sections": [
    {
      "name": "Concept Breakdown",
      "timeMinutes": 10,
      "marks": 1,
      "negativeMarks": 0,
      "questions": [
        {
          "type": "mcq",
          "question": "Question text or $LaTeX$",
          "options": ["Option A", "Option B"],
          "answer": "A",
          "explanation": "Explanation with $LaTeX$ where needed."
        }
      ]
    }
  ]
}

SUPPORTED QUESTION TYPES:
- mcq: question, options, answer, optional explanation
- true_false: question, answer (True or False), optional explanation
- fill_blank: question, acceptedAnswers, optional explanation
- match: question, pairs, optional explanation
- drag_drop: question, pairs, optional explanation
- ordering: question, items, answer, optional explanation
- image_choice: question, image, options, answer, optional explanation

ALIASES MAY INCLUDE:
text, choices, correct, points, negative, duration, category, topic, reason, solution, rationale, hint.

Generate the CBQ from this original question:

${source}`;

 const url="https://chatgpt.com/?q="+encodeURIComponent(prompt);
 const w=window.open(url,"_blank");
 if(!w)toast("Allow pop-ups to open ChatGPT");
}
function showGeneratedCBQs(cbqs){
 window.__generatedCBQs=cbqs;
 let modal=document.getElementById("cbqModal");
 if(!modal){modal=document.createElement("div");modal.id="cbqModal";modal.className="cbq-modal";document.body.appendChild(modal)}
 modal.innerHTML=`<div class="cbq-modal-card"><div class="cbq-modal-head"><div><div class="cbq-kicker">🧠 CONCEPT REPAIR</div><h2>5 CBQs for this question</h2></div><button class="btn" onclick="closeCBQModal()">✕</button></div><div class="cbq-original">${esc(questions[current].text||"")}</div><div class="cbq-list">${cbqs.map((q,i)=>`<article class="generated-cbq"><div class="cbq-number">CBQ ${i+1}</div><div class="cbq-question">${esc(q.question||"")}</div><div class="cbq-options">${(q.options||[]).map((o,j)=>`<button class="cbq-option" onclick="answerGeneratedCBQ(this,${i},'${String.fromCharCode(65+j)}')"><span>${String.fromCharCode(65+j)}</span>${esc(o)}</button>`).join("")}</div><div class="cbq-feedback"></div><div class="cbq-explanation" style="display:none">${esc(q.explanation||"")}</div></article>`).join("")}</div><div class="cbq-modal-foot"><span>Work through all five, then return to the original question.</span><button class="btn primary" onclick="closeCBQModal()">↩ Reattempt Original</button></div></div>`;
 modal.style.display="flex";
 renderAllQuizMath(modal);
 modal.querySelectorAll(".cbq-question,.cbq-option,.cbq-explanation,.cbq-original").forEach(el=>renderAllQuizMath(el));
}
function answerGeneratedCBQ(btn,i,choice){
 const card=btn.closest(".generated-cbq"),q=window.__generatedCBQs?.[i];if(!q)return;
 card.querySelectorAll(".cbq-option").forEach(x=>x.disabled=true);
 const correct=String(q.answer).toUpperCase()===choice;btn.classList.add(correct?"correct":"wrong");
 const fb=card.querySelector(".cbq-feedback");fb.innerHTML=correct?"✓ Correct — continue to the next step.":"✕ Not quite. Review the explanation and continue.";fb.className="cbq-feedback "+(correct?"good":"bad");
 const ex=card.querySelector(".cbq-explanation");ex.style.display="block";renderAllQuizMath(ex);
}
function closeCBQModal(){const m=document.getElementById("cbqModal");if(m)m.remove();window.__generatedCBQs=null}



let lastResultSnapshot=null,resultFilter="all",lastTestStartedAt=0;

function hydrateResult(saved){
  const result={...saved};
  let source=Array.isArray(saved.questions)?saved.questions:null;
  if(!source&&saved.examId)source=getExamRecord(saved.examId)?.questions||null;
  if(!source&&saved.examId){
    const session=get(K.sessions,[]).find(x=>x.examId===saved.examId);
    source=session?.questions||null;
  }
  source=Array.isArray(source)?cloneData(source):[];
  const savedAnswers=Array.isArray(saved.answers)?saved.answers:[];
  result.questions=source.map((q,i)=>({...q,selected:savedAnswers[i]!==undefined?savedAnswers[i]:(q.selected??null)}));
  return result;
}

function openSavedResult(resultId){
  const saved=get(K.results,[]).find(x=>x.id===resultId);if(!saved)return;
  openDetailedResults(saved);
}

function openDetailedResults(result){
 result=hydrateResult(result);
 lastResultSnapshot=result;
 document.getElementById("resultSubtitle").textContent=`${result.name} · ${result.mode==="practice"?"Practice Mode":"Exam Mode"}`;
 document.getElementById("resultScore").textContent=Number(result.score).toFixed(result.score%1?1:0);
 document.getElementById("resultMax").textContent="/"+Number(result.max).toFixed(result.max%1?1:0);
 document.getElementById("resultPercent").textContent=result.percent.toFixed(1)+"%";
 document.getElementById("resultAttempted").textContent=result.correct+result.wrong;
 document.getElementById("resultCorrect").textContent=result.correct;
 document.getElementById("resultWrong").textContent=result.wrong;
 document.getElementById("resultSkipped").textContent=result.unanswered;
 const status=document.getElementById("resultStatus");
 const label=result.percent>=80?"🏆 Excellent":result.percent>=60?"✨ Good Progress":"💪 Needs Improvement";
 status.textContent=label;status.className="result-status"+(result.percent>=80?" good":"");
 document.getElementById("resultProgressBar").style.width=Math.min(100,Math.max(0,result.percent))+"%";
 document.getElementById("resultTime").textContent=`◷ Time taken: ${result.timeTaken||0}s`;
 renderResultSections(result);
 renderResultQuestions();
 const advice=result.percent>=80
   ?"Your fundamentals are working well. Focus on speed, edge cases and maintaining consistency."
   :result.percent>=60
   ?"You have a usable foundation. Review the questions you missed and convert each mistake into a small CBQ."
   :"Go back to concept breakdown. Practice the reasoning steps before attempting another timed test.";
 document.getElementById("resultInsight").textContent=advice;
 document.getElementById("resultNextStep").textContent=result.unanswered
   ?`You left ${result.unanswered} question${result.unanswered>1?"s":""} unanswered. Try completing every question in Practice Mode before the next timed attempt.`
   :"Retake this quiz after reviewing the explanations, then compare your score and accuracy.";
 showView("testResults");
}
function renderResultSections(result){
 const map={};
 result.questions.forEach(q=>{
   const s=q.section||"General";
   if(!map[s])map[s]={total:0,correct:0,wrong:0,skipped:0,marks:0,score:0};
   const x=map[s],selected=q.selected;
   x.total++;x.marks+=Number(q.marks||1);
   if(!answerIsPresent(selected,q))x.skipped++;
   else if(isQuestionCorrect(q,selected)){x.correct++;x.score+=Number(q.marks||1)}
   else{x.wrong++;x.score-=Number(q.negativeMarks||0)}
 });
 const el=document.getElementById("sectionPerformance");
 el.innerHTML=Object.entries(map).map(([name,x])=>{
   const pct=Math.max(0,Math.round(x.score/Math.max(x.marks,1)*100));
   return `<div style="margin-bottom:17px">
     <div class="perf-head"><div class="perf-title">${esc(name)}</div><div class="perf-score">+${x.correct} correct · ${x.wrong} wrong</div></div>
     <div class="perf-meta">Attempted: ${x.correct+x.wrong}/${x.total} · Accuracy: ${x.correct?Math.round(x.correct/Math.max(x.correct+x.wrong,1)*100):0}%</div>
     <div class="perf-bar ${pct>=60?"good":""}"><i style="width:${Math.min(100,pct)}%"></i></div>
     <div style="text-align:right;font-size:9px;color:var(--muted);margin-top:3px">${x.score.toFixed(x.score%1?1:0)}/${x.marks.toFixed(x.marks%1?1:0)}</div>
   </div>`;
 }).join("");
}

function setResultFilter(f){
 resultFilter=f;
 document.querySelectorAll(".filter-btn").forEach(b=>b.classList.toggle("active",b.dataset.filter===f));
 renderResultQuestions();
}
function moveResultQuestion(direction){
 const items=[...document.querySelectorAll("#resultQuestions .result-question")];
 if(!items.length)return;
 const active=document.querySelector("#resultQuestions .result-question.keyboard-current");
 let index=active?items.indexOf(active):(direction>0?-1:items.length);
 index=Math.max(0,Math.min(items.length-1,index+direction));
 items.forEach(item=>item.classList.remove("keyboard-current"));
 const target=items[index];
 target.classList.add("keyboard-current");
 target.scrollIntoView({behavior:"smooth",block:"center"});
}
function resultValueText(q,value){
 if(value==null)return "Not answered";
 if(q.type==="fill_blank")return String(value);
 if(q.type==="match"||q.type==="drag_drop"){
   const vals=Array.isArray(value)?value:[];
   return q.pairs.map((p,i)=>`${esc(p.left)} → ${esc(vals[i]??"")}`).join("<br>");
 }
 if(q.type==="ordering"){
   const vals=Array.isArray(value)?value:[];
   return vals.map((v,i)=>`${i+1}. ${esc(v)}`).join("<br>");
 }
 if(q.type==="image_choice"||q.type==="image"||q.type==="mcq"||q.type==="true_false"){
   const letter=String(value);
   if(/^[A-Z]$/.test(letter)){
     const idx=letter.charCodeAt(0)-65;
     return `${letter}. ${esc(q.options?.[idx]??"")}`;
   }
 }
 return esc(String(value));
}
function correctValueText(q){
 if(q.type==="fill_blank")return (q.acceptedAnswers||[q.answer]).map(esc).join(" / ");
 if(q.type==="match"||q.type==="drag_drop"){
   return q.pairs.map(p=>`${esc(p.left)} → ${esc(p.right)}`).join("<br>");
 }
 if(q.type==="ordering")return q.answer.map((v,i)=>`${i+1}. ${esc(v)}`).join("<br>");
 return resultValueText(q,q.answer);
}
function optionsHtml(q){
 if(q.type==="match"||q.type==="drag_drop"){
   return q.pairs.map(p=>`<div>${esc(p.left)} → ${esc(p.right)}</div>`).join("");
 }
 if(q.type==="ordering"){
   return q.options.map((o,i)=>`${i+1}. ${esc(o)}`).join("<br>");
 }
 if(q.type==="fill_blank")return `<div>Accepted: ${correctValueText(q)}</div>`;
 return (q.options||[]).map((o,i)=>`${String.fromCharCode(65+i)}. ${esc(o)}`).join("<br>");
}
function renderResultQuestions(){
 if(!lastResultSnapshot)return;
 const result=lastResultSnapshot,select=document.getElementById("resultSectionFilter");
 const names=[...new Set(result.questions.map(q=>q.section||"General"))];
 const current=select.value;
 select.innerHTML='<option>All Sections</option>'+names.map(n=>`<option>${esc(n)}</option>`).join("");
 if(names.includes(current))select.value=current;
 const section=select.value;
 const qs=result.questions.map((q,i)=>({...q,index:i})).filter(q=>{
   const selected=q.selected;
   const status=!answerIsPresent(selected,q)?"skipped":isQuestionCorrect(q,selected)?"correct":"wrong";
   return (resultFilter==="all"||status===resultFilter)&&(section==="All Sections"||q.section===section);
 });
 document.getElementById("reviewShown").textContent=`(${qs.length} shown)`;
 const el=document.getElementById("resultQuestions");
 el.innerHTML=qs.length?qs.map(q=>{
   const status=!answerIsPresent(q.selected,q)?"skip":isQuestionCorrect(q,q.selected)?"correct":"wrong";
   const selected=resultValueText(q,q.selected);
   const correct=correctValueText(q);
   return `<div class="result-question ${status}" onclick="this.classList.toggle('open')">
     <div class="result-qno">${q.index+1}</div>
     <div>
       <div class="result-qmeta">SECTION ${esc(q.section||"GENERAL")} <span style="margin-left:5px">· ${status==="correct"?"✓ Correct +"+q.marks:status==="wrong"?"× Wrong":"Skipped"}</span></div>
       <div class="result-qtext">${esc(q.text)}</div>
       <div class="result-review-meta">Type: <strong>${esc(q.type||"mcq")}</strong> Â· Marks: <strong>${status==="correct"?"+"+Number(q.marks||0):status==="wrong"?"-"+Number(q.negativeMarks||0):"0"}</strong></div>
       <div class="result-answer">Your answer: <strong>${selected}</strong>${status!=="correct"?` · Correct: <strong>${correct}</strong>`:""}</div>
       <div class="result-detail">
         ${q.image?`<img class="result-question-image" src="${esc(q.image)}" alt="Question image">`:""}
         <strong>Options / Items</strong>
         <div style="margin-top:5px">${optionsHtml(q)}</div>
         ${q.explanation?`<div class="result-explanation"><strong>💡 Explanation</strong><br>${esc(q.explanation)}</div>`:""}
       </div>
     </div>
     <div class="result-status-icon">${status==="correct"?"✓":status==="wrong"?"×":"−"}</div>
   </div>`;
 }).join(""):'<div class="empty">No questions match this filter.</div>';
 renderAllQuizMath(el);
}

function saveResultCopy(){toast("Result is already saved locally ✓")}
function retakeLastTest(){
 if(!lastResultSnapshot)return;
 const qs=lastResultSnapshot.questions;
 questions=qs.map(q=>({
   type:q.type,text:q.text,options:q.options||[],answer:q.answer,
   acceptedAnswers:q.acceptedAnswers||[],pairs:q.pairs||[],image:q.image||"",
   explanation:q.explanation||"",marks:q.marks,negativeMarks:q.negativeMarks,section:q.section
 }));
 answers=Array(questions.length).fill(null);reviews=new Set();checkedQuestions=new Set();matchOrders={};current=0;
 seconds=Math.min(10,Math.max(1,lastResultSnapshot.durationMinutes||settings.defaultDuration||5))*60;
 quizDurationMinutes=Math.min(10,Math.max(1,lastResultSnapshot.durationMinutes||settings.defaultDuration||5));
 sessionId=null;examName=lastResultSnapshot.name;mode=lastResultSnapshot.mode||settings.defaultMode;examFinished=false;examId=lastResultSnapshot.examId||id();
 timerState.examSeconds=seconds;timerState.practiceSeconds=5*60;timerState.running=false;
 registerActiveExam({name:examName});
 if(document.getElementById("examTitle"))document.getElementById("examTitle").textContent=examName;document.getElementById("headerQuizName").textContent=examName;
 showView("exam");render();saveSession();toast("Retake ready ✓")
}
function saveResult(){
 let correct=0,wrong=0,unanswered=0,score=0,max=0;
 questions.forEach((q,i)=>{max+=Number(q.marks||1);if(!answerIsPresent(answers[i],q))unanswered++;else if(isQuestionCorrect(q,answers[i])){correct++;score+=Number(q.marks||1)}else{wrong++;score-=Number(q.negativeMarks||0)}});
 const percent=Math.max(0,Math.round(score/Math.max(max,1)*100)),timestamp=new Date().toISOString(),r={
  id:id(),name:examName,mode,date:timestamp,timestamp,total:questions.length,
  correct,wrong,unanswered,score,max,percent,durationMinutes:quizDurationMinutes,
  timeTaken:Math.max(0,(quizDurationMinutes*60)-seconds),
  examId:examId||null,
  answers:cloneData(answers),
  matchOrders:cloneData(matchOrders),
  reviews:[...reviews],
  checkedQuestions:[...checkedQuestions]
 };
 if(!examId)registerActiveExam();
 r.examId=examId;
 const rs=get(K.results,[]);rs.unshift(r);put(K.results,rs);backupToPersistentStorage();return r
}
function renderStackedRows(items,renderRow,emptyMessage){
 const list=Array.isArray(items)?items:[];
 if(!list.length)return `<div class="empty">${emptyMessage}</div>`;
 const columns=[];
 for(let i=0;i<list.length;i+=10)columns.push(list.slice(i,i+10));
 return `<div class="stacked-list">${columns.map(column=>`<div class="stack-column">${column.map(renderRow).join("")}</div>`).join("")}</div>`;
}
function planSortNewestFirst(a,b){
 const created=String(b.createdAt||"").localeCompare(String(a.createdAt||""));
 if(created)return created;
 return (String(b.date||"")+" "+String(b.time||"")).localeCompare(String(a.date||"")+" "+String(a.time||""));
}
function renderDashboard(){
 renderRecentQuizzes();
 const ss=get(K.sessions,[]).slice().sort((a,b)=>String(b.updatedAt||b.createdAt||"").localeCompare(String(a.updatedAt||a.createdAt||"")));
 const ssl = document.getElementById("homeSessionsList");
 if(ssl)ssl.innerHTML=renderStackedRows(ss,s=>`<div class="resultrow"><div class="resultmain"><strong>${esc(s.name)}</strong><small>${s.answers.filter(Boolean).length}/${s.questions.length} answered · ${s.mode==="practice"?"Practice":"Exam"}</small></div><div style="display:flex;gap:5px"><button class="btn" onclick="restoreSession(&apos;${s.id}&apos;)">Continue</button><button class="session-delete2" style="border:1px solid var(--line); border-radius:10px; width: 34px; background:transparent; cursor:pointer; color:var(--muted); font-size:16px; display:flex; align-items:center; justify-content:center;" onclick="deleteSession(&apos;${s.id}&apos;)">×</button></div></div>`,`No saved sessions. Add a CBQ to begin.`);
 const rs=get(K.results,[]),avg=rs.length?Math.round(rs.reduce((a,r)=>a+r.percent,0)/rs.length):0,best=rs.length?Math.max(...rs.map(r=>r.percent)):0;
 const attempted=rs.reduce((a,r)=>a+(Number(r.correct)||0)+(Number(r.wrong)||0),0),solved=rs.reduce((a,r)=>a+(Number(r.correct)||0),0);
 document.getElementById("mTests").textContent=rs.length;document.getElementById("mAvg").textContent=avg+"%";document.getElementById("mBest").textContent=best+"%";document.getElementById("mQuestions").textContent=attempted;
 document.getElementById("mSolved").textContent=solved;document.getElementById("mPomodoro").textContent=pomodoroStats.sessions;document.getElementById("mStudyMinutes").textContent=pomodoroStats.minutes;
 document.getElementById("resultsList").innerHTML=rs.length?rs.slice(0,15).map(r=>`<div class="resultrow"><div class="resultmain"><strong>${esc(r.name)}</strong><small>${new Date(r.date).toLocaleString()} · ${r.mode==="practice"?"Practice":"Exam"} · ${r.correct}/${r.total} correct</small></div><div style="display:flex;align-items:center;gap:10px;"><b class="${r.percent>=80?"good":r.percent>=50?"mid":"bad"}">${r.percent}%</b><button class="session-delete" onclick="deleteResult('${r.id}')">×</button></div></div>`).join(""):'<div class="empty">No results yet.</div>';
 document.querySelectorAll("#resultsList .resultrow").forEach((row,i)=>{
   const result=rs[i];if(!result)return;
   row.classList.add("result-history-item");
   row.addEventListener("click",()=>openSavedResult(result.id));
   row.querySelectorAll(".session-delete").forEach(button=>button.addEventListener("click",event=>event.stopPropagation()));
 });
 const latest=rs[0],ad=document.getElementById("advice");
 if(!latest)ad.innerHTML='<div class="empty">Complete a test to unlock performance advice.</div>';
 else ad.innerHTML=`<strong>Latest: ${latest.percent}%</strong><p style="color:var(--muted);font-size:12px;line-height:1.6">${latest.percent>=80?"Strong performance. Push consistency with timed Exam Mode.":latest.percent>=60?"Good foundation. Use Practice Mode on weak topics, then retest.":"Focus on concept breakdown first, then repeat the same quiz after revision."}</p>`;

}
function deleteResult(id) {
  const rs = get(K.results, []);
  put(K.results, rs.filter(r => r.id !== id));
  renderDashboard();
  toast("Result deleted ✓");
}
function setGoalPreset(target){
 document.getElementById("goalTarget").value=target;
 if(!document.getElementById("goalInput").value.trim())document.getElementById("goalInput").value=`Reach ${target}% average in CBQ practice`;

}
function saveGoal(){
 const text=document.getElementById("goalInput").value.trim()||"Improve my CBQ performance";
 const target=Math.max(1,Math.min(100,Number(document.getElementById("goalTarget").value||80)));
 put(K.goal,{text,target,updatedAt:new Date().toISOString()});renderGoal();toast("Goal saved ✓")
}
function renderGoal(){
 const g=get(K.goal,{}),rs=get(K.results,[]),avg=rs.length?Math.round(rs.reduce((a,r)=>a+r.percent,0)/rs.length):0,target=Number(g.target||80),progress=Math.min(100,Math.round(avg/target*100));
 document.getElementById("goalInput").value=g.text||"";
 document.getElementById("goalTarget").value=target;
 document.getElementById("goalLabel").textContent=g.text?`${avg}% average · target ${target}%`:"Set a goal to track progress";
 document.getElementById("goalPercent").textContent=g.text?`${progress}% of goal`:"0%";
 document.getElementById("goalBar").style.width=(g.text?progress:0)+"%";
 document.querySelectorAll(".milestone").forEach(x=>x.classList.toggle("active",Number(x.textContent.match(/\d+/)?.[0])===target));
}
function clearResults(){if(confirm("Delete all saved results?")){localStorage.removeItem(K.results);renderDashboard();toast("Results cleared")}}


function planDateFromSource(source){
  const raw=source.examDate||source.scheduledDate||source.plannedDate||source.date||source.testDate;
  if(raw && /^\d{4}-\d{2}-\d{2}$/.test(String(raw))) return String(raw);
  const d=new Date();d.setDate(d.getDate()+7);
  return d.toISOString().slice(0,10);
}
function planTimeFromSource(source){
  const raw=source.time||source.examTime||source.scheduledTime;
  return raw ? String(raw).slice(0,5) : "";
}
function saveQuickPlan(){
  const box=document.getElementById("planJson"),status=document.getElementById("planJsonStatus");
  const raw=box?.value.trim();
  if(!raw){toast("Paste quiz JSON first");return}
  try{
    const source=JSON.parse(raw);
    const quizSource=source.quiz||source.exam||source;
    const q=parseQuiz(quizSource);
    const name=source.name||q.name||"Planned CBQ";
    const date=planDateFromSource(source);
    const time=planTimeFromSource(source);
    const ps=get(K.plans,[]);
    ps.push({id:id(),name,date,time,notes:"",json:JSON.stringify(quizSource),createdAt:new Date().toISOString()});
    ps.sort(planSortNewestFirst);
    put(K.plans,ps);
    box.value="";
    if(status){status.textContent=`✓ Planned: ${name} · ${date}`;status.style.color="var(--good)"}
    renderPlans();renderHome();toast("Test planned ✓");
  }catch(e){
    if(status){status.textContent="✕ "+e.message+" Common paste formatting is supported."; status.style.color="var(--bad)"}
    toast("Invalid quiz JSON");
  }
}

function savePlan(){
 const name=document.getElementById("planName").value.trim(),date=document.getElementById("planDate").value,time=document.getElementById("planTime").value,notes=document.getElementById("planNotes").value.trim(),raw=document.getElementById("planJson").value.trim();
 if(!name||!date){toast("Add a test name and date");return}
 let json="";
 if(raw){
   try{
     const source=JSON.parse(raw);
     parseQuiz(source); // validate now, but keep the original compatible schema
     json=JSON.stringify(source);
   }catch(e){toast("Invalid quiz JSON: "+e.message);return}
 }
 const ps=get(K.plans,[]);ps.push({id:id(),name,date,time,notes,json,createdAt:new Date().toISOString()});ps.sort(planSortNewestFirst);put(K.plans,ps);
 ["planName","planDate","planTime","planNotes","planJson"].forEach(x=>document.getElementById(x).value="");renderPlans();toast("Future test saved ✓")
}
function renderPlans(){
 const ps=get(K.plans,[]).slice().sort(planSortNewestFirst),el=document.getElementById("plansList");
 const pc=document.getElementById("plannerCount");if(pc)pc.textContent=String(ps.length);
 el.innerHTML=renderStackedRows(ps,p=>`<div class="planrow"><div class="planmain"><strong>${esc(p.name)}</strong><small>${p.date}${p.time?" · "+p.time:""}${p.notes?" · "+esc(p.notes):""}</small></div><div style="display:flex;gap:5px"><button class="btn primary" onclick="startPlan('${p.id}')">▶ Start</button><button class="btn" onclick="deletePlan('${p.id}')">×</button></div></div>`,`No upcoming tests.`);
}
function startPlan(pid){
 const p=get(K.plans,[]).find(x=>x.id===pid);if(!p)return;if(!p.json){toast("No quiz JSON attached to this plan");return}
 const q=parseQuiz(JSON.parse(p.json));questions=prepareShuffledQuiz(q.questions);sections=q.sections;examName=q.name||p.name;examId=p.examId||p.id;quizDurationMinutes=Math.min(10,Math.max(1,q.durationMinutes||settings.defaultDuration||5));answers=Array(questions.length).fill(null);reviews=new Set();checkedQuestions=new Set();matchOrders={};current=0;seconds=quizDurationMinutes*60;timerState.examSeconds=seconds;timerState.practiceSeconds=5*60;timerState.running=false;sessionId=null;mode=settings.defaultMode;examFinished=false;
 registerActiveExam({source:"planned",plannedDate:p.date,plannedTime:p.time,name:p.name});
 if(document.getElementById("examTitle"))document.getElementById("examTitle").textContent=examName;document.getElementById("headerQuizName").textContent=examName;showView("exam");render();setTimeout(applyQuestionSidebarState,50);saveSession();toast("Planned test loaded ✓")
}
function deletePlan(pid){put(K.plans,get(K.plans,[]).filter(x=>x.id!==pid));renderPlans()}
async function importDataFile(event){
  const file=event.target.files?.[0];
  const status=document.getElementById("dataImportStatus");
  if(!file)return;
  try{
    const raw=await file.text();
    const parsed=JSON.parse(raw);

    // Accept only an ExamFlow backup structure. Quiz JSON belongs in
    // "Add CBQ Quiz" and is intentionally not mixed with application backup.
    const allowed=["settings","results","goal","plans","sessions","exams","recent","pomodoroStats"];
    const hasBackup=allowed.some(k=>Object.prototype.hasOwnProperty.call(parsed,k));
    if(!hasBackup)throw new Error("This is a quiz JSON, not an ExamFlow data backup. Use Add CBQ Quiz.");

    const overwrite=confirm(
      "Import this ExamFlow backup?\\n\\n" +
      "This will replace your current settings, results, goals, plans, saved sessions and quiz history with the backup."
    );
    if(!overwrite){
      event.target.value="";
      return;
    }

    if(parsed.settings!==undefined)put(K.settings,parsed.settings);
    if(parsed.results!==undefined)put(K.results,Array.isArray(parsed.results)?parsed.results:[]);
    if(parsed.goal!==undefined)put(K.goal,parsed.goal||{});
    if(parsed.plans!==undefined)put(K.plans,Array.isArray(parsed.plans)?parsed.plans:[]);
    if(parsed.sessions!==undefined)put(K.sessions,Array.isArray(parsed.sessions)?parsed.sessions:[]);
    if(parsed.exams!==undefined)put(K.exams,Array.isArray(parsed.exams)?parsed.exams:[]);
    if(parsed.recent!==undefined)put(K.recent,Array.isArray(parsed.recent)?parsed.recent:[]);
    if(parsed.pomodoroStats!==undefined)put(K.pomodoroStats,parsed.pomodoroStats||{});
    if(parsed.examDeadline!==undefined){
      if(parsed.examDeadline)localStorage.setItem("examflow_exam_deadline",String(parsed.examDeadline));
      else localStorage.removeItem("examflow_exam_deadline");
    }

    settings=loadSettings();pomodoroStats=loadPomodoroStats();
    renderSessions();renderDashboard();renderPlans();renderHome();renderTodos();applySettings();
    await savePersistentBackup();
    if(status){
      status.textContent="✓ Backup imported successfully.";
      status.style.color="var(--good)";
    }
    toast("ExamFlow data imported ✓");
  }catch(err){
    if(status){
      status.textContent="✕ "+(err?.message||"Could not import this JSON.");
      status.style.color="var(--bad)";
    }
    toast("Import failed");
  }finally{
    event.target.value="";
  }
}

function exportData(){
 const data={settings,results:get(K.results,[]),goal:get(K.goal,{}),plans:get(K.plans,[]),sessions:get(K.sessions,[]),exams:get(K.exams,[]),recent:get(K.recent,[]),pomodoroStats},a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));a.download="examflow-data.json";a.click()
}
function resetData(){if(confirm("Reset all local ExamFlow data?")){Object.values(K).forEach(x=>localStorage.removeItem(x));location.reload()}}



async function pasteFromClipboard(targetId,statusId,buttonId){
  const target=document.getElementById(targetId);
  const status=document.getElementById(statusId);
  const btn=document.getElementById(buttonId);
  if(!target)return;
  const original=btn?btn.textContent:"📋 Paste from Clipboard";
  try{
    if(btn){btn.disabled=true;btn.textContent="📋 Reading…";}
    if(!window.isSecureContext || !navigator.clipboard || !navigator.clipboard.readText){
      throw new Error("secure clipboard unavailable");
    }
    const text=await navigator.clipboard.readText();
    if(!text || !text.trim()){
      if(status){status.textContent="Clipboard is empty.";status.style.color="var(--bad)";}
      return;
    }
    target.value=text;
    target.dispatchEvent(new Event("input",{bubbles:true}));
    if(status){
      status.textContent="✓ Pasted directly from clipboard.";
      status.style.color="var(--good)";
    }
    target.focus();
    toast("JSON pasted ✓");
  }catch(err){
    if(status){
      status.textContent="Clipboard access was blocked. Allow clipboard permission for this site, then click Paste again.";
      status.style.color="var(--bad)";
    }
    toast("Clipboard permission blocked");
  }finally{
    if(btn){btn.disabled=false;btn.textContent=original;}
  }
}


/* Final exam date countdown */
function saveExamDeadline(sourceId="planExamDeadlineInput"){
  const v=document.getElementById(sourceId)?.value;
  if(!v){toast("Choose your final exam date");return}
  localStorage.setItem("examflow_exam_deadline",v);
  renderExamDeadline();
  toast("Final exam date saved ✓");
}
function getSavedExamDeadline(){return localStorage.getItem("examflow_exam_deadline")||""}
function setDeadlineInputValue(v){
  ["planExamDeadlineInput","dashboardExamDeadlineInput"].forEach(id=>{
    const input=document.getElementById(id);if(input)input.value=v;
  });
}
function openDeadlinePicker(idValue){
  const input=document.getElementById(idValue);
  if(!input)return;
  if(typeof input.showPicker==="function")input.showPicker();else input.click();
}
function renderExamDeadline(){
  const v=getSavedExamDeadline();
  const targets=[
    [document.getElementById("planExamCountdown"),document.getElementById("planExamDate")],
    [document.getElementById("dashboardExamCountdown"),document.getElementById("dashboardExamDate")]
  ];
  setDeadlineInputValue(v);
  if(!v){
    targets.forEach(([count,date])=>{
      if(count)count.textContent="No exam date set";
      if(date)date.textContent="Choose a target date to start your countdown.";
    });
    return;
  }
  const parts=v.split("-").map(Number),targetUtc=Date.UTC(parts[0],parts[1]-1,parts[2]);
  const now=new Date(),todayUtc=Date.UTC(now.getFullYear(),now.getMonth(),now.getDate());
  const days=Math.round((targetUtc-todayUtc)/86400000);
  const target=new Date(targetUtc),dateText=target.toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"});
  const text=days<0?"Exam date passed":days===0?"Exam day":`${days} day${days===1?"":"s"} remaining`;
  targets.forEach(([count,date])=>{
    if(count)count.textContent=text;
    if(date)date.textContent=days<0?`Target was ${dateText}`:`Target: ${dateText}`;
  });
}
if(!window.examflowDeadlineInterval)window.examflowDeadlineInterval=setInterval(renderExamDeadline,30000);

/* Question progress drawer */

const QUESTION_SIDEBAR_KEY="examflow_question_sidebar_open";

function getQuestionSidebarState(){
  return localStorage.getItem(QUESTION_SIDEBAR_KEY)==="true";
}
function setQuestionSidebarState(open){
  localStorage.setItem(QUESTION_SIDEBAR_KEY, open ? "true" : "false");
}
function applyQuestionSidebarState(){
  const d=document.getElementById("examProgressDrawer");
  const b=document.querySelector(".exam-progress-backdrop");
  if(!d)return;
  const open=getQuestionSidebarState();
  d.classList.toggle("open",open);
  const main=document.querySelector("#examView .main");if(main)main.classList.toggle("palette-shift",open);
  if(b)b.classList.toggle("open",open);
  if(open)renderQuestionProgress();
}

function toggleQuestionProgress(){
  const d=document.getElementById("examProgressDrawer");
  const b=document.querySelector(".exam-progress-backdrop");
  if(!d)return;
  const open=!d.classList.contains("open");
  setQuestionSidebarState(open);
  d.classList.toggle("open",open);
  const main=document.querySelector("#examView .main");if(main)main.classList.toggle("palette-shift",open);
  if(b)b.classList.toggle("open",open);
  if(open)renderQuestionProgress();
}
function renderQuestionProgress(){
  const grid=document.getElementById("examProgressGrid");
  if(!grid||!questions.length)return;
  grid.innerHTML=questions.map((q,i)=>{
    let cls="";
    if(i===current)cls+=" current";
    if(answers[i])cls+=" answered";
    if(reviews.has(i))cls+=" review";
    return `<button class="progress-q${cls}" onclick="jumpToQuestion(${i})">${i+1}</button>`;
  }).join("");
}


function shuffleAllQuestions(){
  if(!questions.length){
    toast("No questions to shuffle");
    return;
  }
  let indices = questions.map((_, i) => i);
  indices = shuffleArray(indices);
  const newQuestions = indices.map(i => questions[i]);
  const newAnswers = indices.map(i => answers[i]);
  const newReviews = new Set();
  reviews.forEach(oldIndex => {
    const newIndex = indices.indexOf(oldIndex);
    if (newIndex !== -1) newReviews.add(newIndex);
  });
  const newCheckedQuestions = new Set();
  checkedQuestions.forEach(oldIndex => {
    const newIndex = indices.indexOf(oldIndex);
    if (newIndex !== -1) newCheckedQuestions.add(newIndex);
  });
  const newMatchOrders = {};
  for(const [oldIdxStr, order] of Object.entries(matchOrders)) {
    const oldIndex = parseInt(oldIdxStr, 10);
    const newIndex = indices.indexOf(oldIndex);
    if(newIndex !== -1) newMatchOrders[newIndex] = order;
  }
  questions = newQuestions;
  answers = newAnswers;
  reviews = newReviews;
  checkedQuestions = newCheckedQuestions;
  matchOrders = newMatchOrders;
  current = 0;
  render();
  renderQuestionProgress();
  saveSessionSoon();
  toast("Questions shuffled ✓");
}

function _ignore_shuffleCurrentOptions(){
  const q=questions[current];
  if(!q || !Array.isArray(q.options) || q.options.length<2){
    toast("This question has no options to shuffle");
    return;
  }

  // Preserve the correct option by its value, then randomize the visible order.
  let correctValue=null;
  if(typeof q.answer==="string"){
    const m=q.answer.trim().match(/^([A-Z])$/i);
    if(m){
      const idx=m[1].toUpperCase().charCodeAt(0)-65;
      if(idx>=0 && idx<q.options.length) correctValue=q.options[idx];
    }else{
      correctValue=q.options.find(x=>String(x).trim()===q.answer.trim()) ?? null;
    }
  }else if(typeof q.answer==="number"){
    correctValue=q.options[q.answer] ?? null;
  }

  let shuffled=[...q.options];
  do{
    shuffled=shuffleArray(shuffled);
  }while(shuffled.length>1 && shuffled.every((x,i)=>String(x)===String(q.options[i])));

  q.options=shuffled;

  if(correctValue!==null){
    const newIndex=shuffled.findIndex(x=>String(x)===String(correctValue));
    if(newIndex>=0) q.answer=String.fromCharCode(65+newIndex);
  }

  // Keep the current selection intact if one exists, but reset checking because
  // the visual order has changed.
  checkedQuestions.delete(current);
  render();
  renderQuestionProgress();
  saveSessionSoon();
  toast("Options randomized ✓");
}

function jumpToQuestion(i){
  if(i<0||i>=questions.length)return;
  current=i;
  render();
  renderQuestionProgress();
  saveSessionSoon();
  if(window.innerWidth <= 800) {
    toggleQuestionProgress();
    window.scrollTo({top: 0, behavior: "smooth"});
  }
}


function shuffleArray(arr){
  const a=[...arr];
  for(let i=a.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}
function prepareShuffledQuiz(qs){
  return qs.map(q=>{
    const copy={...q};
    if(!Array.isArray(copy.options) || copy.options.length<2) return copy;

    // Preserve the actual correct option before shuffling.
    let correctIndex=-1;
    if(typeof copy.answer==="string"){
      const letter=copy.answer.trim().match(/^([A-Z])$/i);
      if(letter){
        correctIndex=letter[1].toUpperCase().charCodeAt(0)-65;
      }else{
        correctIndex=copy.options.findIndex(x=>String(x).trim()===copy.answer.trim());
      }
    }else if(typeof copy.answer==="number"){
      correctIndex=copy.answer;
    }

    const correctValue=correctIndex>=0 ? copy.options[correctIndex] : null;
    const shuffled=shuffleArray(copy.options);
    copy.options=shuffled;

    if(correctValue!==null){
      const newIndex=shuffled.findIndex(x=>String(x)===String(correctValue));
      if(newIndex>=0) copy.answer=String.fromCharCode(65+newIndex);
    }
    return copy;
  });
}

function startHomeQuiz(){
 const raw=document.getElementById("homeJson").value.trim();
 const status=document.getElementById("homeJsonStatus");
 if(!raw){status.textContent="Paste your CBQ JSON first.";status.style.color="var(--bad)";return}
 try{
   const parsed=parseQuiz(parseQuizInput(raw));
   questions=prepareShuffledQuiz(parsed.questions);sections=parsed.sections;examName=parsed.name;examId=id();
   quizDurationMinutes=parsed.durationMinutes||settings.defaultDuration||30;
   answers=Array(questions.length).fill(null);reviews=new Set();checkedQuestions=new Set();matchOrders={};current=0;seconds=quizDurationMinutes*60;timerState.examSeconds=seconds;timerState.practiceSeconds=5*60;timerState.running=false;sessionId=null;mode=settings.defaultMode;examFinished=false;
   if(document.getElementById("examTitle"))document.getElementById("examTitle").textContent=examName;document.getElementById("headerQuizName").textContent=examName;
   if(document.getElementById("examMeta"))document.getElementById("examMeta").textContent=`${questions.length} questions · ${quizDurationMinutes} min · scoring from JSON/settings`;
   registerActiveExam();saveSession();showView("exam");render();toast(`Ready — ${questions.length} questions ✓`);
 }catch(e){status.textContent="✕ "+e.message;status.style.color="var(--bad)"}
}
function pasteAndStart(){
 document.getElementById("homeJson").focus();
 document.getElementById("homeJson").scrollIntoView({behavior:"smooth",block:"center"});
}
function readHomeFile(e){
 const f=e.target.files[0];if(!f)return;
 const r=new FileReader();r.onload=()=>{document.getElementById("homeJson").value=r.result;document.getElementById("homeJsonStatus").textContent="JSON loaded — click Load & Start.";document.getElementById("homeJsonStatus").style.color="var(--good)"};r.readAsText(f)
}

function renderHome(){
 renderRecentQuizzes();
 const rs=get(K.results,[]),ss=get(K.sessions,[]),ps=get(K.plans,[]);
 const avg=rs.length?Math.round(rs.reduce((a,r)=>a+r.percent,0)/rs.length):0,best=rs.length?Math.max(...rs.map(r=>r.percent)):0;
 const solved=rs.reduce((a,r)=>a+(Number(r.correct)||0),0);
 const homeMetrics={homeTests:rs.length,homeQuestions:solved,homePomodoro:pomodoroStats.sessions,homeStudyMinutes:pomodoroStats.minutes};
 Object.entries(homeMetrics).forEach(([key,value])=>{const el=document.getElementById(key);if(el)el.textContent=value});
 const tip=rs.length?(rs[0].percent>=80?"You are in a strong rhythm. Try a timed Exam Mode session next.":rs[0].percent>=60?"Good momentum. Use Practice Mode on your weakest concepts.":"Slow down, break concepts into CBQs, then retest."): "Paste a CBQ below and begin a focused session.";
 const hst=document.getElementById("homeStudyTip"); if(hst) hst.textContent=tip;
 if(!document.getElementById("homePlansList"))return;

 document.getElementById("homePlansList").innerHTML=ps.length?ps.map(x=>`<div class="planrow"><div class="planmain"><strong>${esc(x.name)}</strong><small>${x.date}${x.time?" · "+x.time:""}</small></div><button class="btn" onclick="startPlan('${x.id}')">Start</button></div>`).join(""):'<div class="empty">No future tests planned.</div>';
}


function syncExamTitleBar(){
  const bar=document.getElementById("headerQuizName");
  const globalTitle=document.getElementById("globalExamTitle");
  if(examName){
    if(bar){bar.textContent=examName;bar.title=examName;}
    if(globalTitle){globalTitle.textContent=examName;globalTitle.title=examName;}
  }
  const oldTimer=document.getElementById("timer");
  const globalTimer=document.getElementById("globalTimer");
  if(oldTimer&&globalTimer)globalTimer.textContent=oldTimer.textContent;
}

function showView(name){
 closeMobileNav();
 if(name==="exam" && (!questions || questions.length===0)){
  toast("No quiz loaded. Please open a CBQ first.");
  name="home";
 }
 if(name==="exam"){updateTimerUI();updateModeUI();}
 document.body.classList.toggle("exam-active",name==="exam");
 window.scrollTo({top:0,behavior:"smooth"});
 ["home","exam","dashboard","testResults","planner","settings"].forEach(x=>document.getElementById(x+"View").classList.toggle("active",x===name));
 ["navHome","navExam","navDashboard","navPlanner","navSettings"].forEach(x=>document.getElementById(x).classList.remove("active"));
 if(name!=="testResults")document.getElementById({home:"navHome",exam:"navExam",dashboard:"navDashboard",planner:"navPlanner",settings:"navSettings"}[name]).classList.add("active");
 if(name==="home"){renderHome();if(typeof renderTodos==='function')renderTodos();}if(name==="dashboard"){renderDashboard();renderExamDeadline();}if(name==="planner")renderPlans();if(name==="exam"){setTimeout(()=>{applyQuestionSidebarState();syncExamTitleBar()},0)}
 if(name==="settings"){const feedback=document.getElementById("instantFeedback");if(feedback)feedback.checked=!!settings.instantFeedback;
 const duration=document.getElementById("defaultDuration");if(duration)duration.value=String(settings.defaultDuration||30);
 const marks=document.getElementById("defaultMarks");if(marks)marks.value=settings.defaultMarks??1;
 const negative=document.getElementById("defaultNegative");if(negative)negative.value=settings.defaultNegative??0;
 updateTheme();updateModeUI()}
}
function toggleMobileNav(){document.body.classList.toggle("mobile-nav-open")}
function closeMobileNav(){document.body.classList.remove("mobile-nav-open")}
function toast(s){const x=document.getElementById("toast");x.textContent=s;x.classList.add("show");clearTimeout(window.tt);window.tt=setTimeout(()=>x.classList.remove("show"),2200)}


let examAudioCtx=null;
function ensureExamAudio(){
  try{
    const AC=window.AudioContext||window.webkitAudioContext;
    if(!AC)return null;
    if(!examAudioCtx)examAudioCtx=new AC();
    if(examAudioCtx.state==="suspended")examAudioCtx.resume();
    return examAudioCtx;
  }catch(e){return null}
}
function playExamTone(frequency,duration,volume=0.07,when=0){
  const ctx=ensureExamAudio();
  if(!ctx)return false;
  try{
    const t=ctx.currentTime+when;
    const osc=ctx.createOscillator();
    const gain=ctx.createGain();
    osc.type="sine";
    osc.frequency.setValueAtTime(frequency,t);
    gain.gain.setValueAtTime(0.0001,t);
    gain.gain.exponentialRampToValueAtTime(volume,t+0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001,t+duration);
    osc.connect(gain);gain.connect(ctx.destination);
    osc.start(t);osc.stop(t+duration+0.03);
    return true;
  }catch(e){return false}
}
function playButtonSound(){
  if(settings.soundEnabled===false)return;
  playExamTone(560,.075,.13,0);
}
function playAnswerSound(correct){
  if(settings.soundEnabled===false)return;
  const ctx=ensureExamAudio();
  if(!ctx)return;
  if(correct){
    playExamTone(660,.15,.16,0);
    playExamTone(880,.2,.14,.13);
  }else{
    playExamTone(260,.17,.15,0);
    playExamTone(180,.22,.13,.14);
  }
}
function testAnswerSound(){
  if(settings.soundEnabled===false){
    toast("Enable interface sounds first");
    return;
  }
  const ok=playExamTone(660,.15,.16,0);
  playExamTone(880,.2,.14,.13);
  if(!ok)toast("This browser is blocking audio. Click the page once, then try again.");
}



function practiceCorrectAnswerHTML(q){
  const escv=v=>esc(String(v??""));
  if(q.type==="fill_blank"){
    return (q.acceptedAnswers||[q.answer]).map(escv).join(" / ");
  }
  if(q.type==="match"||q.type==="drag_drop"){
    return q.pairs.map((p,i)=>`<div class="answer-pair"><span>${i+1}.</span><span>${escv(p.left)}</span><span class="answer-arrow">→</span><span>${escv(p.right)}</span></div>`).join("");
  }
  if(q.type==="ordering"){
    return (q.answer||[]).map((v,i)=>`<div><strong>${i+1}.</strong> ${escv(v)}</div>`).join("");
  }
  if(q.type==="true_false")return escv(q.answer);
  if(q.options&&q.options.length){
    const idx=typeof q.answer==="number"?q.answer:
      (/^[A-Z]$/i.test(String(q.answer))?String(q.answer).toUpperCase().charCodeAt(0)-65:q.options.findIndex(o=>String(o)===String(q.answer)));
    if(idx>=0&&idx<q.options.length)return `${String.fromCharCode(65+idx)}. ${escv(q.options[idx])}`;
  }
  return escv(q.answer);
}

function viewPracticeAnswer(){
  if(mode!=="practice"||!questions.length)return;
  const q=questions[current];
  checkedQuestions.add(current);
  render();

  // Create a real answer card if it does not already exist.
  let panel=document.getElementById("practiceAnswerPanel");
  if(!panel){
    panel=document.createElement("div");
    panel.id="practiceAnswerPanel";
    panel.className="practice-answer-panel";
    const ex=document.getElementById("explanation");
    if(ex&&ex.parentNode)ex.parentNode.insertBefore(panel,ex);
    else document.getElementById("options").after(panel);
  }
  panel.dataset.question=String(current);
  panel.innerHTML=`<div class="answer-label">Correct Answer</div><div class="answer-value">${practiceCorrectAnswerHTML(q)}</div>`;
  panel.style.display="block";
  renderAllQuizMath(panel);

  const ex=document.getElementById("explanation");
  if(ex&&q.explanation){
    ex.style.display="block";
    ex.innerHTML="<strong>💡 Explanation</strong><div class='explanation-content' style='white-space:pre-wrap;'>"+esc(q.explanation)+"</div>";
    renderAllQuizMath(ex);
  }
  highlightCorrectAnswerForView(q);
}
function getCorrectOptionIndex(q){
  if(!Array.isArray(q.options))return -1;
  if(typeof q.answer==="number")return q.answer;
  const a=String(q.answer??"").trim();
  if(/^[A-Z]$/i.test(a))return a.toUpperCase().charCodeAt(0)-65;
  return q.options.findIndex(x=>String(x).trim()===a);
}
function highlightCorrectAnswerForView(q){
  const opts=document.getElementById("options");
  if(!opts)return;
  opts.classList.add("answer-revealed");

  if(q.type==="match"||q.type==="drag_drop"){
    const rows=opts.querySelectorAll(".match-row");
    rows.forEach((row,i)=>{
      const pair=q.pairs?.[i];
      if(!pair)return;
      const trigger=row.querySelector(".match-trigger");
      if(trigger){
        trigger.classList.add("answer-correct-reveal");
        trigger.innerHTML=`<span class="match-selected">${esc(pair.right??"")}</span><span class="match-chevron">✓</span>`;
        renderAllQuizMath(trigger);
      }
      row.classList.add("match-correct");
    });
    return;
  }

  if(q.type==="ordering"){
    const list=opts.querySelector(".ordering-list");
    if(list&&Array.isArray(q.answer)){
      list.innerHTML="";
      q.answer.forEach((item,i)=>{
        const b=document.createElement("div");
        b.className="order-item answer-correct-reveal";
        b.textContent=`${i+1}. ${item}`;
        list.appendChild(b);
      });
      renderAllQuizMath(list);
    }
    return;
  }

  if(q.type==="fill_blank"){
    const input=opts.querySelector(".fill-answer");
    if(input){
      input.value=String((q.acceptedAnswers||[q.answer])[0]??"");
      input.classList.add("answer-correct-reveal");
      input.readOnly=true;
      renderAllQuizMath(opts);
    }
    return;
  }

  // MCQ, True/False and Image Choice all use the option renderer.
  if(Array.isArray(q.options)){
    const correctIndex=getCorrectOptionIndex(q);
    opts.querySelectorAll(".option").forEach((b,i)=>{
      if(i===correctIndex)b.classList.add("correct","answer-correct-reveal");
      else b.classList.add("answer-not-correct");
    });
    // image_choice may use image cards instead of .option
    opts.querySelectorAll("[data-option-index]").forEach((b,i)=>{
      if(i===correctIndex)b.classList.add("correct","answer-correct-reveal");
      else b.classList.add("answer-not-correct");
    });
    renderAllQuizMath(opts);
  }
}

function checkCurrentAnswer(){
 if(!questions.length)return;
 const q=questions[current],chosen=answers[current];
 if(!answerIsPresent(chosen,q)){toast("Answer the question first");return}
 const wasChecked=checkedQuestions.has(current);
 checkedQuestions.add(current);
 if(!wasChecked)playAnswerSound(chosen===q.answer);
 const fb=document.getElementById("feedback");
 if(!chosen){toast("Choose an option first");return}
 const correct=isQuestionCorrect(q,chosen);
 fb.textContent=correct?"✓ Correct":"✕ Incorrect";
 fb.style.color=correct?"var(--good)":"var(--bad)";

 const ex=document.getElementById("explanation");
 if(q.explanation){
   ex.style.display="block";
   ex.innerHTML="<strong>💡 Explanation</strong><div style='margin-top:6px;line-height:1.6;white-space:pre-wrap;'>"+esc(q.explanation)+"</div>";
   renderAllQuizMath(ex);
   renderAllQuizMath(document.getElementById("explanation"));
 }
 // In practice mode, checking is always allowed. In exam mode it is
 // intentionally feedback-only and does not reveal correctness until submit.
 if(mode==="exam"){
   fb.textContent="✓ Answer recorded";
   fb.style.color="var(--muted)";
   if(ex)ex.style.display="none";
 }
 flashKey("Enter");
}

function flashKey(key){
 const old=document.getElementById("keyboardFlash");
 if(old)old.remove();
 const el=document.createElement("div");
 el.id="keyboardFlash";
 el.textContent=key;
 el.style.cssText="position:fixed;left:50%;top:82px;transform:translateX(-50%);z-index:90;background:var(--text);color:var(--surface);padding:6px 10px;border-radius:8px;font:800 11px system-ui;opacity:.92;pointer-events:none";
 document.body.appendChild(el);
 setTimeout(()=>el.remove(),500);
}

setTimeout(()=>{if(document.getElementById("examProgressDrawer")?.classList.contains("open"))renderQuestionProgress()},0);
setInterval(()=>{if(document.getElementById("examProgressDrawer")?.classList.contains("open"))renderQuestionProgress()},250);

setInterval(()=>{
  if(universalStudyTimerRunning){
    if(universalStudyTimerMode === 'stopwatch') {
      universalStudyTimerSeconds++;
    } else {
      universalStudyTimerSeconds--;
      if(universalStudyTimerSeconds <= 0) {
         universalStudyTimerSeconds=0;
         if(pomodoroPhase==='focus'){
           pomodoroStats.sessions++;
           pomodoroStats.minutes+=25;
           savePomodoroStats();
           pomodoroCycle++;
           toast("Focus session complete. Take a 5-minute break.");
         }else{
           toast("Break complete. Ready for another focus session.");
         }
         universalStudyTimerRunning = false;
         const btn = document.getElementById("universalTimerToggleBtn");
         if(btn) btn.textContent = "▶ Resume";
      }
    }
    updateUniversalTimerUI();
  }

  if(!timerState || !timerState.running || examFinished)return;
  if(mode==="practice"){
    // Practice timer logic removed, but keeping the block in case of future extensions
  }else{
    if(timerState.examSeconds>0){
      timerState.examSeconds=Math.max(0,timerState.examSeconds-1);
      seconds=timerState.examSeconds;
      updateTimerUI();
      if(timerState.examSeconds%10===0)saveSessionSoon();
      if(timerState.examSeconds<=0)finishTest(true);
    }
  }
},1000);

window.addEventListener("beforeunload",saveSession);

applySettings();timerState.examSeconds=seconds;timerState.practiceSeconds=5*60;timerState.running=false;updateTimerUI();render();renderSessions();renderDashboard();renderPlans();renderHome();renderTodos();

initPersistentBackup();
