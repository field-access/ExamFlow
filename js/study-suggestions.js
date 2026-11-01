/* Local suggestions use the same pending reviews as Plan; no API or new storage. */
window.StudySuggestions=(()=>{
  let actions=[];
  function dateValue(value){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return null;
    const date=new Date(value+'T12:00:00');
    return studyDateKey(date)===value?date:null;
  }
  function daysUntil(value,today){
    const a=value.split('-').map(Number),b=today.split('-').map(Number);
    return Math.round((Date.UTC(a[0],a[1]-1,a[2])-Date.UTC(b[0],b[1]-1,b[2]))/86400000);
  }
  const pretty=value=>dateValue(value)?.toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'})||'';
  function openDate(value){
    showView('planner');
    if(dateValue(value))selectPlannerDate(value);
    else document.getElementById('plannerDateEditor').open=true;
    document.getElementById('plannerDateInput').focus({preventScroll:true});
  }
  function suggestions(){
    const today=studyDateKey(Date.now()),deadline=getSavedExamDeadline(),valid=dateValue(deadline),candidates=[];
    const days=valid?daysUntil(deadline,today):null;
    const exam=valid?{
      title:days<0?'Update your exam date':days===0?'Your exam is today':`Exam in ${days} day${days===1?'':'s'}`,
      detail:days<0?`Your saved date was ${pretty(deadline)}.`:pretty(deadline),action:()=>openDate(deadline)
    }:{title:'Set your exam date',detail:'Add a target date in Plan.',action:()=>openDate('')};
    const queue=PlanReviewQueue.inventory();
    const due=queue.decks.reduce((total,item)=>total+item.due,0);
    const recommended=queue.decks.slice().sort((a,b)=>b.due-a.due)[0];
    if(recommended)candidates.push({priority:90,title:`${due} flashcard${due===1?'':'s'} due`,detail:`Start with ${recommended.deck.name}.`,action:()=>Flashcards.studyDue(recommended.deck.id)});
    const quiz=queue.quizzes.slice().sort((a,b)=>b.mistakes-a.mistakes||b.cards.length-a.cards.length)[0];
    if(quiz){
      const count=queue.quizzes.reduce((total,item)=>total+item.cards.length,0);
      candidates.push({priority:85,title:`${count} quiz question${count===1?'':'s'} to review`,detail:`${quiz.source.name||'Untitled quiz'} · ${quiz.mistakes?`${quiz.mistakes} mistake${quiz.mistakes===1?'':'s'}`:'marked questions'}`,action:()=>CBQReviewPreview.open(quiz.kind,quiz.source.id,{queueOnly:true})});
    }
    const exams=new Set(get(K.exams,[]).map(e=>e.id));
    const plan=get(K.plans,[]).filter(p=>p.json&&dateValue(p.date)&&!exams.has(p.examId||p.id)).sort((a,b)=>(a.date+(a.time||'')).localeCompare(b.date+(b.time||'')))[0];
    if(plan){
      const distance=daysUntil(plan.date,today);
      candidates.push({priority:distance<=0?80:40,title:distance<0?'A planned quiz is overdue':distance===0?'A quiz is planned for today':'Your next planned quiz',detail:`${plan.name} · ${pretty(plan.date)}${plan.time?' · '+plan.time:''}`,action:()=>startPlan(plan.id)});
    }
    const tasks=get('examflow_todos_v1',[]).filter(t=>!t.done&&dateValue(t.deadline)&&t.deadline<=today).sort((a,b)=>a.deadline.localeCompare(b.deadline));
    if(tasks.length)candidates.push({priority:tasks[0].deadline<today?82:70,title:`${tasks.length} task${tasks.length===1?'':'s'} ${tasks[0].deadline<today?'due or overdue':'due today'}`,detail:tasks[0].text,action:()=>{showView('planner');document.getElementById('plannerTodoList').scrollIntoView({block:'center',behavior:'smooth'})}});
    const important=Object.entries(getPlannerDates()).filter(([date,item])=>item.type==='important'&&dateValue(date)&&daysUntil(date,today)>=0&&daysUntil(date,today)<=7).sort(([a],[b])=>a.localeCompare(b))[0];
    if(important)candidates.push({priority:important[0]===today?78:35,title:important[0]===today?'An important date is today':'An important date is coming up',detail:`${important[1].label} · ${pretty(important[0])}`,action:()=>openDate(important[0])});
    const session=get(K.sessions,[]).filter(s=>!s.examFinished&&s.questions?.length).sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')))[0];
    if(session)candidates.push({priority:30,title:'Continue your quiz',detail:`${session.name} · ${studyProgress(session)} / ${session.questions.length} answered`,action:()=>restoreSession(session.id)});
    if(!candidates.length){
      const deck=(get(K.flashcards,{decks:[]}).decks||[]).find(d=>d.cards?.some(c=>c.progress?.state==='new'));
      candidates.push(deck?{priority:10,title:'Learn your new flashcards',detail:deck.name,action:()=>showView('flashcards')}:{priority:10,title:'Start a study session',detail:'Paste a quiz to begin.',action:()=>{showView('home');pasteAndStart();document.getElementById('homeJson').focus({preventScroll:true})}});
    }
    return [exam,...candidates.sort((a,b)=>b.priority-a.priority).slice(0,2)];
  }
  function dismiss(){
    const box=document.getElementById('toast');box.classList.remove('show','study-suggestions');box.replaceChildren();actions=[];
  }
  function show(){
    if(!document.getElementById('homeView').classList.contains('active'))return;
    const box=document.getElementById('toast');
    if(box.classList.contains('show')&&!box.classList.contains('study-suggestions'))return;
    const items=suggestions();actions=items.map(item=>item.action);
    clearTimeout(window.tt);
    box.classList.add('study-suggestions');
    box.innerHTML=`<div class="suggestion-heading"><strong>Study suggestions</strong><button type="button" data-suggestion-close aria-label="Dismiss study suggestions">×</button></div><div class="suggestion-items">${items.map((item,index)=>`<button type="button" data-suggestion="${index}"><span><strong>${esc(item.title)}</strong><small>${esc(item.detail)}</small></span><span aria-hidden="true">›</span></button>`).join('')}</div><button type="button" class="suggestion-plan" data-suggestion-plan>Open Plan →</button>`;
    box.classList.add('show');
  }
  document.addEventListener('click',event=>{
    const item=event.target.closest('#toast [data-suggestion]');
    if(item){const action=actions[Number(item.dataset.suggestion)];dismiss();action?.()}
    else if(event.target.closest('[data-suggestion-close]'))dismiss();
    else if(event.target.closest('[data-suggestion-plan]')){dismiss();showView('planner')}
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&document.getElementById('toast').classList.contains('study-suggestions'))dismiss();
  });
  document.addEventListener('DOMContentLoaded',()=>{
    window.addEventListener('quizflow-library-change',()=>{if(document.getElementById('toast').classList.contains('study-suggestions'))show()});
  });
  return {show,dismiss};
})();
