let studyCalendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let studySelectedDate = null;

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
  const records=studySelectedDate?history.filter(item=>item.date===studySelectedDate):active.map(session=>({kind:'session',sessionId:session.id,name:session.name,mode:session.mode,answered:studyProgress(session),total:session.questions.length,updatedAt:session.updatedAt}));
  const title=studySelectedDate?new Date(`${studySelectedDate}T12:00:00`).toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric',year:'numeric'}):'In progress';
  const cards=records.map(item=>{
    const session=item.sessionId&&sessions.find(s=>s.id===item.sessionId),completed=item.kind==='result',flashcard=item.kind==='flashcards';
    const preview=flashcard?'':window.CBQReviewPreview?.controls(completed?savedResults.find(r=>r.id===item.resultId):session,completed?'result':'session')||'';
    const menu=session&&!completed&&!flashcard?`<details class="study-session-menu"><summary aria-label="Session options for ${esc(item.name||'Untitled quiz')}" title="Session options">⋯</summary><div class="study-session-menu-panel"><button type="button" data-delete-study-session="${esc(session.id)}">Delete session</button></div></details>`:'';
    const action=flashcard?"showView('flashcards')":completed?`openStudyResult('${esc(item.resultId)}')`:session?`restoreSession('${esc(session.id)}')`:'';
    const progress=Math.min(100,Math.round((item.answered||0)/Math.max(item.total||0,1)*100));
    const updated=item.updatedAt?new Date(item.updatedAt):null;
    const time=updated&&!Number.isNaN(updated.getTime())?updated.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'';
    return `<article class="study-session-card"><div class="study-card-meta"><span>${flashcard?'Flashcards':item.mode==='practice'?'Practice':'Exam'}</span><div class="study-card-status">${completed?'Completed':'Progress saved'}${menu}</div></div><h4>${esc(item.name||'Untitled quiz')}</h4><p>${flashcard?`${item.answered} card reviews`:`${completed?`${item.percent}% score · `:''}${item.answered||0} / ${item.total||0} answered`}</p><div class="study-progress" role="progressbar" aria-label="${flashcard?'Saved flashcard reviews':'Answered questions'}" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100"><i style="width:${progress}%"></i></div>${preview}<div class="study-card-footer"><small>${esc(time)}</small>${action?`<button class="btn" type="button" onclick="${action}">${flashcard?'Open flashcards':completed?'Review':'Continue'} →</button>`:'<small>Session no longer saved</small>'}</div></article>`;
  }).join('');
  return `<div class="study-workspace"><div class="study-calendar-column"><div class="study-month-nav"><button class="btn" type="button" aria-label="Previous month" onclick="shiftStudyMonth(-1)">‹</button><strong>${studyCalendarMonth.toLocaleDateString(undefined,{month:'long',year:'numeric'})}</strong><button class="btn" type="button" aria-label="Next month" onclick="shiftStudyMonth(1)">›</button></div><div class="study-weekdays">${['M','T','W','T','F','S','S'].map(day=>`<span>${day}</span>`).join('')}</div><div class="study-calendar-days">${dayButtons.join('')}</div><p class="study-calendar-legend"><i></i> Saved study activity</p><label class="study-date-label" for="studyDateJump">Go to date</label><input id="studyDateJump" type="date" value="${studySelectedDate||''}" onchange="chooseStudyDate(this.value)"><div class="study-date-actions"><button class="btn" type="button" onclick="chooseStudyDate('${today}')">Today</button><button class="btn" type="button" onclick="clearStudyDate()">All sessions</button></div></div><div class="study-content-column"><div class="study-list-heading"><h4>${esc(title)}</h4><span>${records.length} ${studySelectedDate?'records':'sessions'}</span></div><div class="study-session-grid">${cards||`<div class="study-empty"><strong>${studySelectedDate?'No recorded study on this date':'Nothing to resume yet'}</strong><p>${studySelectedDate?'Choose a marked date to see its saved activity.':'Load a CBQ and your progress will appear here.'}</p></div>`}</div></div></div>`;
}

document.addEventListener('click',event=>{
  const menu=event.target.closest('.study-session-menu');
  document.querySelectorAll('.study-session-menu[open]').forEach(item=>{if(item!==menu)item.open=false});
  const button=event.target.closest('[data-delete-study-session]');
  if(button){
    deleteSession(button.dataset.deleteStudySession);
    document.querySelector('#homeSessionsList .study-session-menu summary')?.focus({preventScroll:true});
  }
});
document.addEventListener('keydown',event=>{
  if(event.key!=='Escape')return;
  const menu=document.querySelector('.study-session-menu[open]');
  if(menu){menu.open=false;menu.querySelector('summary').focus({preventScroll:true})}
});
