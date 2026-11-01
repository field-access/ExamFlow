function openPlanComposer(){
  const dialog=document.getElementById('planComposer');
  document.getElementById('planJsonStatus').textContent=KeyboardShortcuts.mac?'Cmd+Enter to plan':'Ctrl+Enter to plan';
  if(!dialog.open)dialog.showModal();
  document.getElementById('planJson').focus();
}
function closePlanComposer(){document.getElementById('planComposer').close()}
document.addEventListener('DOMContentLoaded',()=>{
  const dialog=document.getElementById('planComposer');
  dialog.addEventListener('close',()=>document.getElementById('openPlanComposerBtn').focus({preventScroll:true}));
});
