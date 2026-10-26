/* User keys are forwarded per request, never stored or logged by the server. */
const BASE='https://api.anthropic.com/v1/';
const networkFailure=require('../lib/ai-network.cjs');
const object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const nullable=schema=>({anyOf:[schema,{type:'null'}]});
const strings={type:'array',items:{type:'string'}};
const quizSchema=object({
  name:{type:'string'},
  sections:{type:'array',minItems:1,items:object({
    name:{type:'string'},timeMinutes:nullable({type:'integer'}),
    marks:nullable({type:'number'}),negativeMarks:nullable({type:'number'}),
    questions:{type:'array',minItems:1,items:object({
      type:{type:'string',enum:['mcq','true_false','fill_blank','match','drag_drop','ordering']},
      question:{type:'string'},explanation:{type:'string'},hint:nullable({type:'string'}),options:nullable(strings),
      answer:{anyOf:[{type:'string'},{type:'integer'},{type:'boolean'},strings]},
      acceptedAnswers:nullable(strings),
      pairs:nullable({type:'array',items:object({left:{type:'string'},right:{type:'string'}})}),
      marks:nullable({type:'number'}),negativeMarks:nullable({type:'number'})
    })}
  })}
});
const validModel=id=>typeof id==='string'&&/^claude-[a-z0-9-]{1,100}$/.test(id);
function supportedModel(model){
  if(!validModel(model.id)||model.lifecycle==='retired'||model.lifecycle?.status==='retired')return false;
  const supported=model.capabilities?.structured_outputs?.supported;
  if(typeof supported==='boolean')return supported;
  return /^claude-(?:(?:opus|sonnet|haiku)-4-[5-9](?:-|$)|(?:opus|sonnet|haiku|fable|mythos)-[5-9](?:-|$)|mythos-preview)/.test(model.id);
}
function reply(res,status,data){if(!res.destroyed)res.status(status).json(data)}
function failure(status,message){const error=new Error(message);error.status=status;return error}
function omitNull(value){
  if(Array.isArray(value))return value.map(omitNull);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==null).map(([k,v])=>[k,omitNull(v)]));
  return value;
}
async function claude(path,key,signal,body){
  const response=await fetch(BASE+path,{
    method:body?'POST':'GET',headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},
    ...(body?{body:JSON.stringify(body)}:{}),signal
  });
  const raw=await response.text();
  if(raw.length>2000000)throw failure(502,'The Claude response was too large. Request fewer questions.');
  let data;try{data=JSON.parse(raw)}catch{}
  if(!response.ok){
    if(response.status===401||response.status===403)throw failure(401,'Claude could not authorize this key. Check the Anthropic API key and its permissions.');
    if(response.status===429)throw failure(429,'Claude API rate limit or quota reached. Check your Anthropic API limits and credits, or try later.');
    if(response.status===404)throw failure(400,'That Claude model is unavailable. Reconnect to refresh the model list.');
    if(response.status===400){
      const credits=/credit balance|insufficient.*credit|billing/i.test(data?.error?.message||'');
      throw failure(400,credits?'Your Anthropic account has insufficient API credits. Claude subscriptions do not include API usage.':'Claude rejected the request. Choose a model with structured output support, or shorten the source and prompt.');
    }
    throw failure(502,response.status===529?'Claude is overloaded. Try again later.':'Claude is unavailable right now. Try again later.');
  }
  if(!data)throw failure(502,'Claude returned an unreadable response.');
  return data;
}
module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return reply(res,405,{error:'Use POST for Claude requests.'})}
  if(req.headers['sec-fetch-site']==='cross-site')return reply(res,403,{error:'Use Claude from this app.'});
  if(!String(req.headers['content-type']||'').includes('application/json'))return reply(res,415,{error:'Send a JSON request.'});
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),52000);
  const disconnect=()=>{if(!res.writableEnded)controller.abort()};res.on('close',disconnect);
  try{
    let body=req.body;
    if(Buffer.isBuffer(body))body=body.toString('utf8');
    if(typeof body==='string'){
      if(body.length>100000)throw failure(413,'The source and prompt are too large.');
      try{body=JSON.parse(body)}catch{throw failure(400,'Invalid request JSON.')}
    }
    if(!body||typeof body!=='object'||Array.isArray(body)||JSON.stringify(body).length>100000)throw failure(400,'Invalid generation request.');
    const key=req.headers['x-claude-api-key'];
    if(typeof key!=='string'||! /^[\x21-\x7e]{20,1024}$/.test(key))throw failure(400,'Paste the complete Anthropic API key without spaces or line breaks.');
    if(body.action==='models'){
      const models=[];let cursor='';
      for(let page=0;page<3;page++){
        const data=await claude('models?limit=1000'+(cursor?'&after_id='+encodeURIComponent(cursor):''),key,controller.signal);
        models.push(...(Array.isArray(data.data)?data.data:[]).filter(supportedModel).map(m=>({id:m.id,name:m.display_name||m.id,line:m.line||null})));
        if(!data.has_more||!data.last_id||data.last_id===cursor)break;
        cursor=data.last_id;
      }
      return reply(res,200,{models});
    }
    if(body.action!=='generate')throw failure(400,'Unknown Claude action.');
    if(!validModel(body.model))throw failure(400,'Select a Claude text model.');
    if(typeof body.source!=='string'||!body.source.trim()||body.source.length>30000)throw failure(400,'Provide a topic or source of up to 30,000 characters.');
    if(typeof body.prompt!=='string'||!body.prompt.trim()||body.prompt.length>30000)throw failure(400,'Choose a saved prompt of up to 30,000 characters.');
    if(![0,5,10,15,25].includes(body.count))throw failure(400,'Choose a supported question count.');
    const prompt=body.prompt.replace(/\{\{\s*(question|source|topic)\s*\}\}/gi,()=>body.source);
    const system='Create a connected Concept Breakdown Quiz for the supplied source. Follow the saved prompt and source CBQ modes. Return JSON using the supplied schema without code fences. Use plain English and accurate concise explanations. MCQ answers must be option letters (A, B, etc.); respect the option count requested in the prompt. For true_false use a boolean answer. Fill-blank answers must have nonempty acceptedAnswers. Ordering options must be the same items as the answer sequence; matching pairs need left and right text. Use null for fields that do not apply, including acceptedAnswers outside fill_blank and pairs outside matching. Use sensible section timing and marks. Escape LaTeX backslashes in JSON. Do not invent citations. '+(body.count?'Generate exactly '+body.count+' questions.':'Follow the question count in the saved prompt/source; default to 5, maximum 200.');
    const data=await claude('messages',key,controller.signal,{
      model:body.model,max_tokens:body.count?Math.min(12000,Math.max(2400,body.count*420+1000)):8192,
      system,messages:[{role:'user',content:'Saved CBQ prompt:\n'+prompt+'\n\nTopic / source:\n'+body.source}],
      output_config:{format:{type:'json_schema',schema:quizSchema}}
    });
    if(data.stop_reason==='refusal')throw failure(422,'Claude declined this source. Try rephrasing the topic.');
    if(data.stop_reason==='max_tokens')throw failure(422,'The response was cut short. Try fewer questions or a shorter prompt.');
    if(data.stop_reason!=='end_turn')throw failure(422,'Claude could not finish this quiz. Try another topic or model.');
    const text=(data.content||[]).filter(item=>item.type==='text'&&typeof item.text==='string').map(item=>item.text).join('');
    let quiz;try{quiz=omitNull(JSON.parse(text))}catch{throw failure(422,'Claude returned invalid JSON. Try fewer questions or another model.')}
    if(!quiz||!Array.isArray(quiz.sections))throw failure(422,'Claude returned an invalid quiz structure. Try another prompt or model.');
    const count=quiz.sections.reduce((n,s)=>n+(Array.isArray(s?.questions)?s.questions.length:0),0);
    if(!count||count>200)throw failure(422,'Claude returned an empty or oversized quiz. Try fewer questions.');
    return reply(res,200,{quiz,model:body.model,usage:{inputTokens:data.usage?.input_tokens||0,outputTokens:data.usage?.output_tokens||0}});
  }catch(error){
    if(error.name!=='AbortError'&&!error.status)return reply(res,502,networkFailure('Claude',error));
    return reply(res,error.name==='AbortError'?504:error.status||502,{error:error.name==='AbortError'?'The Claude request timed out. Try a faster model and fewer questions.':error.status?error.message:'The app server could not reach Claude. Check server network access and try again.'});
  }finally{clearTimeout(timeout);res.removeListener('close',disconnect)}
};
