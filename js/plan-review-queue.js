/* Plan reviews reuse saved attempts and the existing flashcard scheduler. */
window.PlanReviewQueue=(()=>{
  function validateReceipts(value){
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.values(value).some(cards=>!cards||typeof cards!=='object'||Array.isArray(cards)||Object.entries(cards).some(([index,stamp])=>!/^\d+$/.test(index)||typeof stamp!=='string'||!/^[a-z0-9]+-[a-z0-9]+$/.test(stamp))))throw Error('Invalid quiz review queue in backup.');
    return value;
  }
  const receipts=()=>{try{return validateReceipts(get(K.reviewQueue,{}))}catch{return {}}};
  function signature(card){
    const text=JSON.stringify([card.q,card.selected,card.review,card.mistake]);
    let a=2166136261,b=5381;
    for(let i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619);b=Math.imul(b,33)^text.charCodeAt(i)}
    return (a>>>0).toString(36)+'-'+(b>>>0).toString(36);
  }
  const sourceKey=(kind,id)=>kind+':'+id;
  function pending(kind,source,cards){
    const saved=receipts()[sourceKey(kind,source.id)]||{};
    return cards.filter(card=>saved[card.index]!==signature(card));
  }
  function reviewed(kind,id,card){
    const saved=receipts(),key=sourceKey(kind,id);
    saved[key]={...(saved[key]||{}),[card.index]:signature(card)};
    put(K.reviewQueue,saved);render();
  }
  function removeQuestion(id,index){
    if(!id)return;
    const saved=receipts(),key=sourceKey('session',id);
    if(!saved[key])return;
    const next=Object.fromEntries(Object.entries(saved[key]).filter(([n])=>Number(n)!==index).map(([n,stamp])=>[Number(n)>index?Number(n)-1:Number(n),stamp]));
    if(Object.keys(next).length)saved[key]=next;else delete saved[key];
    put(K.reviewQueue,saved);
  }
  function render(){
    const host=document.getElementById('planReviewQueue');if(!host)return;
    const latest=new Map(),now=Date.now(),rows=[];
    const attempts=[...get(K.sessions,[]).map(source=>({kind:'session',source})),...get(K.results,[]).map(source=>({kind:'result',source}))];
    attempts.sort((a,b)=>String(b.source.updatedAt||b.source.date||b.source.timestamp||'').localeCompare(String(a.source.updatedAt||a.source.date||a.source.timestamp||'')));
    for(const entry of attempts){const key=entry.source.examId||entry.source.id;if(!latest.has(key))latest.set(key,entry)}
    let count=0;
    for(const {kind,source} of latest.values()){
      const info=CBQReviewPreview.inspect(source,kind==='result');
      if(!info.allowed)continue;
      const cards=pending(kind,source,info.cards);if(!cards.length)continue;
      count+=cards.length;
      const marked=cards.filter(c=>c.review).length,mistakes=cards.filter(c=>c.mistake).length;
      const reasons=[mistakes?`${mistakes} mistake${mistakes===1?'':'s'}`:'',marked?`${marked} marked`:''].filter(Boolean).join(' · ');
      rows.push(`<article class="plan-review-row"><div><strong>${esc(source.name||'Untitled quiz')}</strong><small>${reasons}</small></div><button type="button" class="btn" data-plan-review="${esc(kind)}" data-source-id="${esc(source.id)}">Review</button></article>`);
    }
    const store=get(K.flashcards,{decks:[]});
    for(const deck of store.decks||[]){
      if(!Array.isArray(deck.cards))continue;
      const due=deck.cards.filter(c=>c.progress&&c.progress.state!=='new'&&c.progress.due<=now).length;
      if(!due)continue;
      count+=due;
      rows.push(`<article class="plan-review-row"><div><strong>${esc(deck.name)}</strong><small>${due} due flashcard${due===1?'':'s'}</small></div><button type="button" class="btn" data-plan-deck="${esc(deck.id)}">Study</button></article>`);
    }
    document.getElementById('planReviewCount').textContent=String(count);
    host.innerHTML=rows.join('')||'<div class="empty">Nothing to review right now.</div>';
  }
  document.addEventListener('click',event=>{
    const start=event.target.closest('[data-start-plan]'),remove=event.target.closest('[data-delete-plan]');
    if(start)startPlan(start.dataset.startPlan);
    else if(remove)deletePlan(remove.dataset.deletePlan);
    const quiz=event.target.closest('[data-plan-review]'),deck=event.target.closest('[data-plan-deck]');
    if(quiz)CBQReviewPreview.open(quiz.dataset.planReview,quiz.dataset.sourceId,{queueOnly:true});
    else if(deck)Flashcards.studyDue(deck.dataset.planDeck);
  });
  document.addEventListener('DOMContentLoaded',()=>{
    setInterval(()=>{if(document.getElementById('plannerView')?.classList.contains('active'))render()},60000);
    window.addEventListener('quizflow-library-change',()=>{if(document.getElementById('plannerView')?.classList.contains('active'))render()});
  });
  return {render,pending,reviewed,removeQuestion,validateReceipts};
})();
