/* Separate generation workspace. Nothing is saved until the existing quiz importer runs. */
(() => {
  const $=id=>document.getElementById(id);
  const providers={
    gemini:{name:'Gemini',endpoint:'/api/gemini',header:'x-gemini-api-key',keyPattern:/^[\x21-\x7e]{20,1024}$/,company:'Google',keyUrl:'https://aistudio.google.com/apikey',billing:'Uses your Gemini project’s quota and billing.'},
    openai:{name:'OpenAI',endpoint:'/api/openai',header:'x-openai-api-key',keyPattern:/^[\x21-\x7e]{20,1024}$/,company:'OpenAI',keyUrl:'https://platform.openai.com/api-keys',billing:'Uses OpenAI API credits. ChatGPT subscriptions do not include API usage.'},
    claude:{name:'Claude',endpoint:'/api/claude',header:'x-claude-api-key',keyPattern:/^[\x21-\x7e]{20,1024}$/,company:'Anthropic',keyUrl:'https://platform.claude.com/settings/keys',billing:'Uses Claude API credits. Claude subscriptions do not include API usage.'}
  };
  const provider=()=>providers[$('genProvider').value]||providers.gemini;
  let connectedKey='',busy=false,controller=null,allModels=[];
  const preferenceKey='quizflow_ai_preferences_v1';
  const keyStore=id=>'quizflow_ai_key_'+id+'_v1';
  function adoptKeyProvider(key){
    const detected=/^(AQ\.|AIza)/.test(key)?'gemini':key.startsWith('sk-ant-')?'claude':key.startsWith('sk-')?'openai':null;
    if(!detected||$('genProvider').value===detected)return;
    const remember=$('genRememberKey').checked;
    $('genProvider').value=detected;$('genRememberKey').checked=remember;
    connectedKey='';allModels=[];$('genModel').innerHTML='<option value="">Connect your key first</option>';
    showProvider();savePreferences();
  }
  function readStored(name){try{return localStorage.getItem(name)}catch{return null}}
  function writeStored(name,value){try{if(value===null)localStorage.removeItem(name);else localStorage.setItem(name,value);return true}catch{return false}}
  function preferences(){try{return JSON.parse(readStored(preferenceKey))||{}}catch{return {}}}
  function savePreferences(){const previous=preferences();writeStored(preferenceKey,JSON.stringify({...previous,provider:$('genProvider').value,freeOnly:$('genFreeOnly').checked,models:{...previous.models,...($('genModel').value?{[$('genProvider').value]:$('genModel').value}:{})}}))}
  function saveKey(){
    const key=$('genApiKey').value.trim(),remember=$('genRememberKey').checked;
    const value=remember&&provider().keyPattern.test(key)?key:null;
    if(!writeStored(keyStore($('genProvider').value),value)){status('Browser storage is unavailable. The key can be used for this visit, but could not be saved or removed.',true);return false}
    return true;
  }
  function restoreKey(){
    const key=readStored(keyStore($('genProvider').value));
    $('genApiKey').value=key&&provider().keyPattern.test(key)?key:'';
    $('genRememberKey').checked=!!$('genApiKey').value;
    if($('genApiKey').value)$('genConnectionState').textContent='Saved key · Connect to verify';
    showProvider();
  }
  const fileMode=()=>location.protocol==='file:';
  const serverHelp='AI generation needs the app server. In the project folder, run npm run dev, then open http://127.0.0.1:3000. Opening index.html directly or using a static preview cannot run API requests.';
  function status(message,error=false){$('genStatus').textContent=message;$('genStatus').classList.toggle('is-error',error)}
  function updateBusy(value){
    busy=value;
    $('genProvider').disabled=value;
    $('genRememberKey').disabled=value;$('genFreeOnly').disabled=value;
    $('genConnect').disabled=value||fileMode();$('genForget').disabled=value;
    $('genApiKey').readOnly=value;$('genSource').readOnly=value;$('genJson').readOnly=value;
    $('genModel').disabled=value||!connectedKey||!$('genModel').value;$('genPrompt').disabled=value;$('genCount').disabled=value;
    $('genSubmit').disabled=value||!connectedKey||!$('genPrompt').value||!$('genModel').value;
    $('genOpenQuiz').disabled=value;$('genDownload').disabled=value;
    $('genCancel').hidden=!value;$('genSubmit').textContent=value?'Working…':'Generate quiz';
    $('genForm').setAttribute('aria-busy',String(value));
  }
  function refresh(){
    if(!$('genPrompt')||busy)return;
    const selected=$('genPrompt').value;
    const prompts=promptLibrary.prompts.filter(p=>p.text.trim());
    $('genPrompt').replaceChildren();
    for(const prompt of prompts){const option=document.createElement('option');option.value=prompt.id;option.textContent=prompt.name;$('genPrompt').append(option)}
    if(!prompts.length){const option=document.createElement('option');option.value='';option.textContent='Add a saved CBQ prompt in Settings';$('genPrompt').append(option)}
    else $('genPrompt').value=prompts.some(p=>p.id===selected)?selected:prompts.some(p=>p.id===promptLibrary.activeId)?promptLibrary.activeId:prompts[0].id;
    showPrompt();updateBusy(false);
  }
  function showPrompt(){const prompt=promptLibrary.prompts.find(p=>p.id===$('genPrompt').value);$('genPromptText').textContent=prompt?.text||'Save a CBQ prompt in Settings first.'}
  function showProvider(){
    const selected=provider();
    $('genConnectionLabel').textContent=selected.name+' connection';
    $('genKeyLabel').textContent='Your '+selected.name+' API key';
    $('genKeyNote').textContent=($('genRememberKey').checked?'Stored in this browser without encryption. Anyone with access to this browser profile can access it. ':'Kept only for this visit. ')+'Sent through this app’s server to '+selected.company+'. Excluded from quiz exports and backups.';
    $('genKeyLink').href=selected.keyUrl;$('genKeyLink').textContent='Get an '+selected.name+' key ↗';
    if(selected===providers.gemini)$('genKeyLink').textContent='Get a Gemini key ↗';
    if(selected===providers.claude)$('genKeyLink').textContent='Get a Claude key ↗';
    $('genBilling').textContent=selected.billing;
    $('genFreeFilter').hidden=selected!==providers.gemini;
    $('genModelPricing').href=selected===providers.gemini?'https://ai.google.dev/gemini-api/docs/pricing':selected===providers.claude?'https://platform.claude.com/docs/en/about-claude/pricing':'https://openai.com/api/pricing/';
    showModelNote();
  }
  function showModelNote(){
    if(provider()!==providers.gemini){$('genModelNote').textContent='Requests use your '+provider().name+' API credits. The Gemini free-tier filter does not apply.';return}
    const model=allModels.find(m=>m.id===$('genModel').value);
    $('genModelNote').textContent=model?.tier==='paid'?'This model has no published free tier. Generation uses your project’s billing.':model?.tier==='unverified'?'Free-tier availability for this model is unverified. Check pricing before generating.':'Free-tier eligible does not guarantee zero cost on a paid project. Check your project’s tier and available quota.';
  }
  function renderModels(selectedId){
    const freeOnly=provider()===providers.gemini&&$('genFreeOnly').checked;
    const models=allModels.filter(m=>!freeOnly||m.tier==='free');
    $('genModel').replaceChildren();
    for(const model of models){const option=document.createElement('option');option.value=model.id;option.textContent=model.name+(provider()===providers.gemini?' · '+(model.tier==='free'?'Free tier':model.tier==='paid'?'Paid only':'Check pricing'):'');$('genModel').append(option)}
    if(!models.length){const option=document.createElement('option');option.value='';option.textContent=freeOnly?'No listed free-tier models available':'Connect your key first';$('genModel').append(option)}
    else{
      const previous=models.find(m=>m.id===selectedId);
      const preferred=provider()===providers.claude
        ?models.find(m=>m.line==='haiku')||models.find(m=>/haiku/.test(m.id))||models.find(m=>m.line==='sonnet')||models[0]
        :provider()===providers.openai
        ?models.find(m=>m.id==='gpt-4.1-mini')||models.find(m=>m.id==='gpt-5-mini')||models.find(m=>/mini/.test(m.id))||models[0]
        :models.find(m=>m.id==='gemini-3.5-flash-lite')||models.find(m=>m.tier==='free'&&/flash/.test(m.id))||models[0];
      $('genModel').value=(previous||preferred).id;
    }
    showModelNote();updateBusy(busy);
    return models.length;
  }
  function forget(removeSaved=false){
    if(removeSaved&&!writeStored(keyStore($('genProvider').value),null)){status('Could not remove the saved key. Check browser storage permissions.',true);return false}
    controller?.abort();connectedKey='';$('genApiKey').value='';$('genConnectionState').textContent='Not connected';$('genConnection').open=true;
    allModels=[];$('genApiKey').removeAttribute('aria-invalid');
    if(removeSaved)$('genRememberKey').checked=false;
    $('genModel').innerHTML='<option value="">Connect your key first</option>';
    updateBusy(false);
    return true;
  }
  async function request(payload,key){
    if(fileMode())throw new Error(serverHelp);
    const selected=provider();
    const activeController=new AbortController();controller=activeController;
    const timer=setTimeout(()=>activeController.abort(),65000);
    try{
      const response=await fetch(selected.endpoint,{
        method:'POST',headers:{'Content-Type':'application/json',[selected.header]:key},
        body:JSON.stringify(payload),signal:activeController.signal,cache:'no-store',credentials:'same-origin'
      });
      if(response.status===404||!response.headers.get('content-type')?.includes('application/json'))throw new Error('The '+selected.name+' API endpoint is missing. Run npm run dev locally, or redeploy this project to Vercel with its api folder. A static server only serves the study pages.');
      let data;try{data=await response.json()}catch{throw new Error('The app server returned an unreadable response. Restart the local server or check your Vercel deployment.')}
      if(!response.ok){const error=new Error(typeof data.error==='string'?data.error:selected.name+' request failed (HTTP '+response.status+'). Check your app server deployment.');error.code=data.code;error.status=response.status;throw error}
      return data;
    }catch(error){
      if(error instanceof TypeError)throw new Error('Cannot reach the app server. If running locally, start npm run dev and open http://127.0.0.1:3000. Otherwise check your network and Vercel deployment. Your key has not been verified.');
      throw error;
    }finally{clearTimeout(timer);if(controller===activeController)controller=null}
  }
  async function connect(){
    if(busy)return;
    if(fileMode()){status(serverHelp,true);return}
    const key=$('genApiKey').value.trim();
    adoptKeyProvider(key);
    const selected=provider();
    if(!selected.keyPattern.test(key)){$('genApiKey').setAttribute('aria-invalid','true');status('Paste the complete '+selected.name+' API key without quotes, spaces or line breaks.',true);$('genApiKey').focus();return}
    $('genApiKey').value=key;$('genApiKey').removeAttribute('aria-invalid');
    saveKey();savePreferences();
    connectedKey='';allModels=[];$('genModel').innerHTML='<option value="">Checking access…</option>';$('genConnectionState').textContent='Connecting…';
    updateBusy(true);status('Connecting to '+selected.name+'…');
    try{
      const data=await request({action:'models'},key);
      const models=Array.isArray(data.models)?data.models:[];
      if(!models.length)throw new Error('No supported '+selected.name+' text-generation models are available for this key.');
      models.sort((a,b)=>b.id.localeCompare(a.id,undefined,{numeric:true}));
      allModels=models;connectedKey=key;
      const visibleCount=renderModels(preferences().models?.[$('genProvider').value]);savePreferences();
      $('genConnectionState').textContent='Connected';$('genConnection').open=false;
      status(visibleCount?'Connected. Choose a prompt and enter your source.':'Connected, but none of the returned models are in the published free-tier list. Turn off the filter to inspect other models and their pricing.',!visibleCount);
    }catch(error){connectedKey='';$('genConnectionState').textContent='Not connected';$('genConnection').open=true;$('genModel').innerHTML='<option value="">Connect your key first</option>';if(error.status===401||error.status===403)$('genApiKey').setAttribute('aria-invalid','true');status(error.name==='AbortError'?'Connection cancelled or timed out.':error.message,true)}
    finally{updateBusy(false)}
  }
  function previewResult(raw){
    $('genJson').value=raw;$('genResult').hidden=false;
    const parsed=parseQuiz(parseQuizInput(raw));
    if(parsed.questions.length>200)throw new Error('This quiz contains more than 200 questions.');
    $('genResultTitle').textContent=parsed.name;
    $('genResultMeta').textContent=parsed.questions.length+' questions · '+parsed.durationMinutes+' min · Ready to open';
    $('genQuestions').replaceChildren();
    for(const question of parsed.questions){const item=document.createElement('li');setQuizRichText(item,question.text,{literalNewlines:false});$('genQuestions').append(item)}
    renderAllQuizMath($('genQuestions'));
    return parsed;
  }
  async function generate(){
    if(busy)return;
    if(!connectedKey||connectedKey!==$('genApiKey').value.trim()){status('Connect your '+provider().name+' key first.',true);$('genConnection').open=true;return}
    if(!$('genModel').value){status('Choose an available model first.',true);return}
    const prompt=promptLibrary.prompts.find(p=>p.id===$('genPrompt').value),source=$('genSource').value.trim();
    if(!source){status('Enter a topic or paste your source first.',true);$('genSource').focus();return}
    if(!prompt?.text.trim()){status('Choose a saved CBQ prompt.',true);return}
    updateBusy(true);status('Generating your quiz… Your current quiz stays in place.');
    try{
      const data=await request({action:'generate',source,prompt:prompt.text,model:$('genModel').value,count:Number($('genCount').value),freeTierOnly:provider()===providers.gemini&&$('genFreeOnly').checked},connectedKey);
      const raw=JSON.stringify(data.quiz,null,2);
      try{
        const parsed=previewResult(raw);
        const expected=Number($('genCount').value);
        if(expected&&parsed.questions.length!==expected)status(provider().name+' returned '+parsed.questions.length+' questions instead of '+expected+'. Review the output before opening.',true);
        else status('Quiz generated and validated. Open it when you’re ready.');
      }catch(error){
        $('genResultTitle').textContent='Review generated JSON';$('genResultMeta').textContent='Needs a correction before opening';$('genQuestions').replaceChildren();$('genJsonDetails').open=true;
        status('The generated quiz needs a correction: '+error.message+' Edit the JSON below. Your current quiz was not changed.',true);
      }
    }catch(error){if(error.status===401||error.status===403){connectedKey='';$('genConnectionState').textContent='Reconnect required';$('genConnection').open=true}status(error.name==='AbortError'?'Generation cancelled or timed out. You can try again.':error.message,true)}
    finally{updateBusy(false)}
  }
  function openQuiz(){
    if(busy)return;
    const raw=$('genJson').value;
    try{
      previewResult(raw);
      if(questions.length&&!examFinished)saveSession();
      $('jsonInput').value=raw;
      loadQuiz();
    }catch(error){status('Cannot open this quiz: '+error.message,true);$('genJsonDetails').open=true;$('genJson').focus()}
  }
  function download(){
    const value=$('genJson').value;if(!value)return;
    const blob=new Blob([value],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download='quizflow-generated-quiz.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function handleKey(event){
    if(!$('generateView')?.classList.contains('active'))return false;
    if(event.key==='Escape'&&busy){event.preventDefault();controller?.abort();return true}
    if((event.ctrlKey||event.metaKey)&&event.key==='Enter'&&!event.altKey&&!event.shiftKey){
      event.preventDefault();if(!event.repeat&&!busy){if(event.target.id==='genApiKey')connect();else if(event.target.id==='genJson')openQuiz();else generate()}return true;
    }
    return false;
  }
  function clearSavedKeys(){for(const id of Object.keys(providers))writeStored(keyStore(id),null);writeStored(preferenceKey,null)}
  window.GeminiGenerator={refresh,handleKey,clearSavedKeys};
  document.addEventListener('DOMContentLoaded',()=>{
    const prefs=preferences();if(Object.hasOwn(providers,prefs.provider))$('genProvider').value=prefs.provider;$('genFreeOnly').checked=prefs.freeOnly!==false;
    restoreKey();$('genProvider').onchange=()=>{if(busy)return;forget();restoreKey();savePreferences();status('Connect your '+provider().name+' key to verify access.')};
    refresh();$('genConnect').onclick=connect;$('genForget').onclick=()=>{if(forget(true)){showProvider();status('Key removed from this browser and this visit.')}};
    $('genRememberKey').onchange=()=>{adoptKeyProvider($('genApiKey').value.trim());saveKey();showProvider()};
    $('genFreeOnly').onchange=()=>{renderModels($('genModel').value);savePreferences()};
    $('genModel').onchange=()=>{showModelNote();savePreferences()};
    $('genApiKey').addEventListener('input',()=>{$('genApiKey').removeAttribute('aria-invalid');if(busy){controller?.abort();return}connectedKey='';allModels=[];$('genConnectionState').textContent='Not connected';$('genModel').innerHTML='<option value="">Connect your key first</option>';adoptKeyProvider($('genApiKey').value.trim());saveKey();showModelNote();updateBusy(false)});
    $('genPrompt').onchange=()=>{showPrompt();updateBusy(false)};
    $('genEditPrompts').onclick=()=>showView('settings');
    $('genForm').onsubmit=event=>{event.preventDefault();generate()};
    $('genCancel').onclick=()=>controller?.abort();$('genOpenQuiz').onclick=openQuiz;$('genDownload').onclick=download;
    window.addEventListener('pagehide',()=>forget(false));
    window.addEventListener('pageshow',event=>{if(event.persisted){restoreKey();refresh()}});
    if(fileMode())$('genServerNotice').hidden=false;
  });
})();
