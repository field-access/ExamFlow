/* Date indexing is a library view; it never changes flashcard scheduling. */
window.FlashcardLibrary=(()=>{
 let month=new Date(new Date().getFullYear(),new Date().getMonth(),1),selected='',collection='decks';
 const dayKey=value=>{const date=new Date(value);if(!value||Number.isNaN(date.getTime()))return '';return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0')};
 const saved=deck=>deck.kind==='cbq-review'||deck.name==='Saved quiz explanations';
 const timestamp=deck=>saved(deck)?deck.lastSavedAt||deck.createdAt||0:deck.createdAt||0;
 const dayLabel=key=>key?new Date(key+'T12:00:00').toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}):'Earlier decks';
 function grouped(decks,renderCard){
  const groups=new Map();
  for(const deck of [...decks].sort((a,b)=>timestamp(b)-timestamp(a)||a.name.localeCompare(b.name))){
   const key=dayKey(timestamp(deck));if(selected&&key!==selected)continue;
   if(!groups.has(key))groups.set(key,[]);groups.get(key).push(deck);
  }
  return [...groups].map(([key,items])=>'<section class="fc-date-group"><h3>'+esc(dayLabel(key))+'</h3><div class="fc-decks">'+items.map(renderCard).join('')+'</div></section>').join('');
 }
 function calendar(decks){
  const counts=new Map();for(const d of decks){const key=dayKey(timestamp(d));if(key)counts.set(key,(counts.get(key)||0)+1)}
  const start=(month.getDay()+6)%7,days=new Date(month.getFullYear(),month.getMonth()+1,0).getDate(),today=dayKey(Date.now());
  let grid=Array.from({length:start},()=>'<span></span>').join('');
  for(let day=1;day<=days;day++){
   const key=dayKey(new Date(month.getFullYear(),month.getMonth(),day).getTime()),count=counts.get(key)||0;
   grid+='<button type="button" data-fc-date="'+key+'" class="'+(count?'has-decks ':'')+(key===selected?'is-selected ':'')+(key===today?'is-today':'')+'" aria-pressed="'+(key===selected)+'" aria-label="'+esc(dayLabel(key)+', '+count+' saved '+(count===1?'deck':'decks'))+'" title="'+count+' saved '+(count===1?'deck':'decks')+'">'+day+'</button>';
  }
  return '<div class="fc-month-nav"><button type="button" class="btn" data-fc-month="-1" aria-label="Previous month">‹</button><strong>'+esc(month.toLocaleDateString(undefined,{month:'long',year:'numeric'}))+'</strong><button type="button" class="btn" data-fc-month="1" aria-label="Next month">›</button></div><div class="fc-calendar-weekdays">'+['M','T','W','T','F','S','S'].map(d=>'<span>'+d+'</span>').join('')+'</div><div class="fc-calendar-days">'+grid+'</div><label for="fcDateJump">Go to date</label><input id="fcDateJump" type="date" value="'+selected+'"><button type="button" class="btn fc-all-dates" data-fc-all-dates>All dates</button>'+(selected?'<p class="fc-selected-date" role="status">'+esc(dayLabel(selected))+'</p>':'');
 }
 function render(decks,card){
  document.getElementById('fcDateIndex').innerHTML=calendar(decks.filter(d=>saved(d)===(collection==='reviews')));
  document.getElementById('fcDeckSection').hidden=collection!=='decks';document.getElementById('fcReviewSection').hidden=collection!=='reviews';
  document.querySelectorAll('[data-fc-collection]').forEach(button=>{const active=button.dataset.fcCollection===collection;button.setAttribute('aria-pressed',String(active));button.classList.toggle('is-active',active)});
  for(const [isSaved,target,countTarget] of [[false,'fcDecks','fcDeckCount'],[true,'fcSavedReviews','fcSavedReviewCount']]){
   const list=decks.filter(d=>saved(d)===isSaved),visible=list.filter(d=>!selected||dayKey(timestamp(d))===selected);
   document.getElementById(countTarget).textContent=String(list.length);
   document.getElementById(target).innerHTML=grouped(list,card)||'<div class="fc-date-empty">'+(selected?'Nothing saved on this date.':isSaved?'No saved CBQ reviews.':'No decks yet.')+'</div>';
  }
 }
 const refresh=()=>window.Flashcards?.renderLibrary();
 document.addEventListener('click',event=>{
  const date=event.target.closest('[data-fc-date]'),nav=event.target.closest('[data-fc-month]'),all=event.target.closest('[data-fc-all-dates]');
  const switcher=event.target.closest('[data-fc-collection]');
  if(switcher){collection=switcher.dataset.fcCollection;selected='';refresh();switcher.focus({preventScroll:true})}
  else if(date){selected=selected===date.dataset.fcDate?'':date.dataset.fcDate;refresh();document.querySelector('[data-fc-date="'+date.dataset.fcDate+'"]')?.focus({preventScroll:true})}
  else if(nav){month=new Date(month.getFullYear(),month.getMonth()+Number(nav.dataset.fcMonth),1);refresh();document.querySelector('[data-fc-month="'+nav.dataset.fcMonth+'"]')?.focus({preventScroll:true})}
  else if(all){selected='';refresh();document.querySelector('[data-fc-all-dates]')?.focus({preventScroll:true})}
 });
 document.addEventListener('change',event=>{
  if(event.target.id!=='fcDateJump')return;
  selected=event.target.value;if(selected){const date=new Date(selected+'T12:00:00');month=new Date(date.getFullYear(),date.getMonth(),1)}
  refresh();document.getElementById('fcDateJump')?.focus({preventScroll:true});
 });
 return {render,saved,clearDate(next){selected='';if(next)collection=next}};
})();
