let studyCalendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let studySelectedDate = null;
let studySearchQuery = '', studySearchScope = 'all', studySearchTimer;

function studySearchText(value) {
  return String(value ?? '').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/\s+/g,' ').trim();
}
function studySessionRecord(session) {
  return {kind:'session',sessionId:session.id,examId:session.examId,name:session.name,mode:session.mode,
    answered:studyProgress(session),total:session.questions?.length||0,updatedAt:session.updatedAt};
}
function studySearchInventory(sessions,results,exams) {
  const records=[],seen=new Set();
  const add=(item,key)=>{if(!seen.has(key)){seen.add(key);records.push(item)}};
  // Prefer resumable work, then the latest result, then the original quiz.
  const newest=list=>list.slice().sort((a,b)=>String(b.updatedAt||b.date||b.timestamp||'').localeCompare(String(a.updatedAt||a.date||a.timestamp||'')));
  newest(sessions.filter(s=>!s.examFinished)).forEach(s=>add(studySessionRecord(s),s.examId||s.id));
  newest(results).forEach(r=>add({kind:'result',resultId:r.id,examId:r.examId,name:r.name,mode:r.mode,answered:Number(r.correct||0)+Number(r.wrong||0),total:r.total,percent:r.percent,updatedAt:r.date||r.timestamp},r.examId||r.id));
  newest(sessions.filter(s=>s.examFinished)).forEach(s=>add(studySessionRecord(s),s.examId||s.id));
  newest(exams).forEach(e=>add({kind:'quiz',examId:e.id,name:e.name,answered:0,total:e.questions?.length||0,updatedAt:e.updatedAt},e.id));
  return records;
}
function studyFindMatch(item,source,tokens) {
  const title=studySearchText(item.name);
  const reveal=source?.mode==='practice'||source?.examFinished===true||item.kind==='result';
  const parts=(Array.isArray(source?.questions)?source.questions:[]).map((q,index)=>{
    if(!q||typeof q!=='object')return {index,text:'',normalized:''};
    const text=[q.text||q.question||'',...(Array.isArray(q.options)?q.options:[]),q.section||'',q.hint||'',...(reveal?[q.explanation||'']:[]),...(Array.isArray(q.pairs)?q.pairs.map(p=>p?.left||''):[])].join(' ');
    return {index,text,normalized:studySearchText(text)};
  });
  const body=parts.map(p=>p.normalized).join(' ');
  const haystack=studySearchScope==='title'?title:studySearchScope==='content'?body:title+' '+body;
  if(!tokens.every(token=>haystack.includes(token)))return null;
  const titleMatch=tokens.every(token=>title.includes(token));
  const hits=parts.map(p=>({...p,score:tokens.filter(token=>p.normalized.includes(token)).length})).filter(p=>p.score>0).sort((a,b)=>b.score-a.score||a.index-b.index);
  let snippet='';
  if(studySearchScope!=='title'&&hits.length){
    const hit=hits[0],text=hit.text.replace(/\s+/g,' ').trim();
    const position=Math.max(0,...tokens.map(t=>hit.normalized.indexOf(t)).filter(n=>n>=0).slice(0,1));
    const start=Math.max(0,position-45);
    snippet=`Question ${hit.index+1} · ${start?'…':''}${text.slice(start,start+150)}${text.length>start+150?'…':''}`;
  }
  return {titleMatch,snippet};
}
function refreshStudySearch(restoreFocus=false) {
  const host=document.getElementById('homeSessionsList');if(!host)return;
  const input=document.getElementById('studyQuizSearch'),position=input?.selectionStart,end=input?.selectionEnd;
  host.innerHTML=renderStudyWorkspace(get(K.sessions,[]));
  if(restoreFocus){const next=document.getElementById('studyQuizSearch');next.focus({preventScroll:true});if(position!=null)next.setSelectionRange(position,end??position)}
}

function studyDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
function studyProgress(session) {
  return (session.answers || []).filter((answer, index) => answerIsPresent(answer, session.questions?.[index] || {})).length;
}
function recordStudyActivity(session) {
  const answered = studyProgress(session);
  if (!answered) return;
  const date = studyDateKey(session.updatedAt);
  const entries = get(K.study, []);
  const next = {sessionId:session.id, examId:session.examId, date, name:session.name,
    mode:session.mode, answered, total:session.questions.length, updatedAt:session.updatedAt};
  const old = entries.find(item => item.sessionId === session.id && item.date === date);
  if (old) Object.assign(old, next); else entries.push(next);
  put(K.study, entries);
}
function studyHistory(sessions) {
  const entries = get(K.study, []).map(item => ({...item, kind:'session'}));
  for(const item of get(K.flashcards,{}).activity||[])entries.push({...item,kind:'flashcards',answered:item.reviewed,total:item.reviewed,mode:'flashcards'});
  for (const session of sessions) {
    const date = studyDateKey(session.updatedAt || session.createdAt);
    if (!date || !studyProgress(session) || entries.some(item => item.sessionId === session.id && item.date === date)) continue;
    entries.push({kind:'session', sessionId:session.id, examId:session.examId, date,
      name:session.name, mode:session.mode, answered:studyProgress(session), total:session.questions.length,
      updatedAt:session.updatedAt || session.createdAt});
  }
  for (const result of get(K.results, [])) {
    const date = studyDateKey(result.date || result.timestamp);
    if (!date) continue;
    // A completed result replaces that quiz's progress snapshot for the day.
    for (let i=entries.length-1;i>=0;i--) {
      if (entries[i].kind==='session' && result.examId && entries[i].examId===result.examId && entries[i].date===date) entries.splice(i,1);
    }
    entries.push({kind:'result', resultId:result.id, date, name:result.name, mode:result.mode,
      answered:Number(result.correct||0)+Number(result.wrong||0), total:result.total,
      percent:result.percent, updatedAt:result.date || result.timestamp});
  }
  return entries.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
function chooseStudyDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return;
  const date = new Date(`${value}T12:00:00`);
  if (studyDateKey(date)!==value) return;
  studySelectedDate=value;
  studyCalendarMonth=new Date(date.getFullYear(),date.getMonth(),1);
  renderDashboard();
}
function shiftStudyMonth(delta) {
  studyCalendarMonth=new Date(studyCalendarMonth.getFullYear(),studyCalendarMonth.getMonth()+delta,1);
  renderDashboard();
}
function clearStudyDate(){studySelectedDate=null;renderDashboard()}
function openStudyResult(idValue){const result=get(K.results,[]).find(item=>item.id===idValue);if(result)openDetailedResults(result)}

function renderStudyWorkspace(sessions) {
  const history=studyHistory(sessions),year=studyCalendarMonth.getFullYear(),month=studyCalendarMonth.getMonth();
  const dayCounts=new Map();
  for(const item of history)dayCounts.set(item.date,(dayCounts.get(item.date)||0)+1);
  const offset=(new Date(year,month,1).getDay()+6)%7,days=new Date(year,month+1,0).getDate(),today=studyDateKey(new Date());
  const dayButtons=Array.from({length:offset},()=>'<span></span>');
  for(let day=1;day<=days;day++){
    const key=studyDateKey(new Date(year,month,day)),count=dayCounts.get(key)||0;
    const label=new Date(year,month,day).toLocaleDateString(undefined,{dateStyle:'full'});
    dayButtons.push(`<button class="study-day${key===today?' is-today':''}${key===studySelectedDate?' is-selected':''}" type="button" aria-label="${esc(label)}${count?`, ${count} study records`:''}" aria-pressed="${key===studySelectedDate}" onclick="chooseStudyDate('${key}')"><span>${day}</span>${count?'<i aria-hidden="true"></i>':''}</button>`);
  }
  const active=sessions.filter(session=>!session.examFinished);
  const savedResults=get(K.results,[]);
  const savedExams=get(K.exams,[]),sessionMap=new Map(sessions.map(s=>[s.id,s])),resultMap=new Map(savedResults.map(r=>[r.id,r])),examMap=new Map(savedExams.map(e=>[e.id,e]));
  const sourceFor=item=>item.kind==='result'?resultMap.get(item.resultId):item.sessionId?sessionMap.get(item.sessionId)||examMap.get(item.examId):examMap.get(item.examId);
  const tokens=[...new Set(studySearchText(studySearchQuery).split(' ').filter(Boolean))];
  const searching=tokens.length>0;
  let records=studySelectedDate?history.filter(item=>item.date===studySelectedDate):searching?studySearchInventory(sessions,savedResults,savedExams):active.map(studySessionRecord);
  if(searching){records=records.filter(item=>item.kind!=='flashcards').map(item=>({...item,match:studyFindMatch(item,sourceFor(item),tokens)})).filter(item=>item.match).sort((a,b)=>Number(b.match.titleMatch)-Number(a.match.titleMatch)||String(b.updatedAt).localeCompare(String(a.updatedAt)))}
  const title=studySelectedDate?new Date(`${studySelectedDate}T12:00:00`).toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric',year:'numeric'}):searching?'Matching quizzes':'In progress';
  const cards=records.map(item=>{
    const session=item.sessionId&&sessions.find(s=>s.id===item.sessionId),completed=item.kind==='result',flashcard=item.kind==='flashcards';
    const preview=flashcard?'':window.CBQReviewPreview?.controls(completed?savedResults.find(r=>r.id===item.resultId):session,completed?'result':'session')||'';
    const menu=session&&!completed&&!flashcard?`<details class="study-session-menu"><summary aria-label="Session options for ${esc(item.name||'Untitled quiz')}" title="Session options">⋯</summary><div class="study-session-menu-panel"><button type="button" data-export-study-session="${esc(session.id)}">Download session JSON</button><button type="button" data-delete-study-session="${esc(session.id)}">Delete session</button></div></details>`:'';
    const action=flashcard?'flashcards':completed&&resultMap.has(item.resultId)?'result':session?'session':item.examId&&examMap.has(item.examId)?'quiz':'';
    const actionId=completed?item.resultId:session?session.id:item.examId||'';
    const progress=Math.min(100,Math.round((item.answered||0)/Math.max(item.total||0,1)*100));
    const updated=item.updatedAt?new Date(item.updatedAt):null;
    const time=updated&&!Number.isNaN(updated.getTime())?updated.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'';
    return `<article class="study-session-card"><div class="study-card-meta"><span>${flashcard?'Flashcards':item.kind==='quiz'?'Saved quiz':item.mode==='practice'?'Practice':'Exam'}</span><div class="study-card-status">${completed?'Completed':item.kind==='quiz'?'Ready to start':'Progress saved'}${menu}</div></div><h4>${esc(item.name||'Untitled quiz')}</h4>${item.match?.snippet?`<p class="study-search-match">${esc(item.match.snippet)}</p>`:''}<p>${flashcard?`${item.answered} card reviews`:`${completed?`${item.percent}% score · `:''}${item.answered||0} / ${item.total||0} answered`}</p><div class="study-progress" role="progressbar" aria-label="${flashcard?'Saved flashcard reviews':'Answered questions'}" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100"><i style="width:${progress}%"></i></div>${preview}<div class="study-card-footer"><small>${esc(time)}</small>${action?`<button class="btn" type="button" data-study-open="${action}" data-study-id="${esc(actionId)}">${flashcard?'Open flashcards':completed?'Review':item.kind==='quiz'?'Start':'Continue'} →</button>`:'<small>Session no longer saved</small>'}</div></article>`;
  }).join('');
  const searchBar=`<div class="study-search-bar"><input id="studyQuizSearch" type="search" maxlength="160" value="${esc(studySearchQuery)}" placeholder="Search previous quizzes by topic…" aria-label="Search previous quiz titles and content" aria-controls="studySearchResults" autocomplete="off"><select id="studySearchScope" aria-label="Search in"><option value="all"${studySearchScope==='all'?' selected':''}>Title & content</option><option value="title"${studySearchScope==='title'?' selected':''}>Title only</option><option value="content"${studySearchScope==='content'?' selected':''}>Content only</option></select>${searching?'<button class="btn" type="button" data-clear-study-search aria-label="Clear quiz search">×</button>':''}</div>`;
  return `<div class="study-workspace"><div class="study-calendar-column"><div class="study-month-nav"><button class="btn" type="button" aria-label="Previous month" onclick="shiftStudyMonth(-1)">‹</button><strong>${studyCalendarMonth.toLocaleDateString(undefined,{month:'long',year:'numeric'})}</strong><button class="btn" type="button" aria-label="Next month" onclick="shiftStudyMonth(1)">›</button></div><div class="study-weekdays">${['M','T','W','T','F','S','S'].map(day=>`<span>${day}</span>`).join('')}</div><div class="study-calendar-days">${dayButtons.join('')}</div><p class="study-calendar-legend"><i></i> Saved study activity</p><label class="study-date-label" for="studyDateJump">Go to date</label><input id="studyDateJump" type="date" value="${studySelectedDate||''}" onchange="chooseStudyDate(this.value)"><div class="study-date-actions"><button class="btn" type="button" onclick="chooseStudyDate('${today}')">Today</button><button class="btn" type="button" onclick="clearStudyDate()">All sessions</button></div></div><div class="study-content-column">${searchBar}<div class="study-list-heading"><h4>${esc(title)}</h4><span>${records.length} ${studySelectedDate?'records':searching?'quizzes':'sessions'}</span></div><div id="studySearchResults" class="study-session-grid">${cards||`<div class="study-empty"><strong>${searching?'No matching quizzes':studySelectedDate?'No recorded study on this date':'Nothing to resume yet'}</strong><p>${searching?'Try fewer keywords or another search scope. Clear the date filter to search all saved quizzes.':studySelectedDate?'Choose a marked date to see its saved activity.':'Load a CBQ and your progress will appear here.'}</p></div>`}</div></div></div>`;
}

document.addEventListener('click',event=>{
  if(event.target.closest('[data-clear-study-search]')){clearTimeout(studySearchTimer);studySearchQuery='';refreshStudySearch(true);return}
  const open=event.target.closest('[data-study-open]');
  if(open){const kind=open.dataset.studyOpen,sourceId=open.dataset.studyId;if(kind==='flashcards')showView('flashcards');else if(kind==='result')openStudyResult(sourceId);else if(kind==='session')restoreSession(sourceId);else if(kind==='quiz')openRecentQuiz(sourceId);return}
  const menu=event.target.closest('.study-session-menu');
  document.querySelectorAll('.study-session-menu[open]').forEach(item=>{if(item!==menu)item.open=false});
  const download=event.target.closest('[data-export-study-session]');
  if(download){exportSessionJSON(download.dataset.exportStudySession);if(menu)menu.open=false;return}
  const button=event.target.closest('[data-delete-study-session]');
  if(button){
    deleteSession(button.dataset.deleteStudySession);
    document.querySelector('#homeSessionsList .study-session-menu summary')?.focus({preventScroll:true});
  }
});
function queueStudySearch(event){
  if(event.target.id!=='studyQuizSearch'||event.isComposing)return;
  studySearchQuery=event.target.value;
  clearTimeout(studySearchTimer);
  studySearchTimer=setTimeout(()=>refreshStudySearch(document.activeElement?.id==='studyQuizSearch'),140);
}
document.addEventListener('input',queueStudySearch);
document.addEventListener('compositionend',queueStudySearch);
document.addEventListener('change',event=>{
  if(event.target.id!=='studySearchScope'||!['all','title','content'].includes(event.target.value))return;
  clearTimeout(studySearchTimer);studySearchScope=event.target.value;refreshStudySearch();document.getElementById('studySearchScope')?.focus({preventScroll:true});
});
document.addEventListener('keydown',event=>{
  if(event.key!=='Escape')return;
  const menu=document.querySelector('.study-session-menu[open]');
  if(menu){menu.open=false;menu.querySelector('summary').focus({preventScroll:true})}
});
