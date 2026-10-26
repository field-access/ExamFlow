/* Vercel Function. User keys are forwarded per request, never stored or logged. */
const BASE='https://api.openai.com/v1/';
const networkFailure=require('../lib/ai-network.cjs');
const object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const nullable=schema=>({anyOf:[schema,{type:'null'}]});
const strings={type:'array',items:{type:'string'}};
const quizSchema=object({
  name:{type:'string'},
  sections:{type:'array',minItems:1,items:object({
    name:{type:'string'},timeMinutes:nullable({type:'integer'}),
    marks:nullable({type:'number'}),negativeMarks:nullable({type:'number'}),
    questions:{type:'array',minItems:1,maxItems:200,items:object({
      type:{type:'string',enum:['mcq','true_false','fill_blank','match','drag_drop','ordering']},
      question:{type:'string'},explanation:{type:'string'},hint:nullable({type:'string'}),
      options:nullable(strings),
      answer:{anyOf:[{type:'string'},{type:'integer'},{type:'boolean'},strings]},
      acceptedAnswers:nullable(strings),
      pairs:nullable({type:'array',items:object({left:{type:'string'},right:{type:'string'}})}),
      marks:nullable({type:'number'}),negativeMarks:nullable({type:'number'})
    })}
  })}
});
// The models endpoint has no capability metadata. Limit choices to modern text families.
function supportedModel(id){
  return typeof id==='string'&&id.length<=120&&/^[a-zA-Z0-9._-]+$/.test(id)
    &&/^(?:gpt-(?:[5-9](?:[.-]|$)|4\.1(?:-|$)|4o(?:-|$))|o[34](?:-|$))/.test(id)
    &&!/audio|realtime|transcrib|tts|image|search|deep-research|codex|chat|(?:^|-)pro(?:-|$)|gpt-4o-2024-05-13/.test(id);
}
function reply(res,status,data){if(!res.destroyed)res.status(status).json(data)}
function failure(status,message){const error=new Error(message);error.status=status;return error}
// Nullable schema fields are optional in the existing importer; omit them from portable JSON.
function omitNull(value){
  if(Array.isArray(value))return value.map(omitNull);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==null).map(([k,v])=>[k,omitNull(v)]));
  return value;
}
async function openai(path,key,signal,body){
  const response=await fetch(BASE+path,{
    method:body?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},
    ...(body?{body:JSON.stringify(body)}:{}),signal
  });
  if(!response.ok){
    if(response.status===401||response.status===403)throw failure(401,'OpenAI could not authorize this key. Check the API key permissions and project access.');
    if(response.status===429){
      const raw=await response.text();let code='';
      if(raw.length<=2000000){try{code=JSON.parse(raw).error?.code||''}catch{}}
      throw failure(429,code==='insufficient_quota'?'This OpenAI project has no available API credits. Add credits or check project billing limits. ChatGPT subscriptions do not include API usage.':'OpenAI API quota or rate limit reached. Check project billing and limits, or try later.');
    }
    if(response.status===404)throw failure(400,'That OpenAI model is unavailable. Reconnect to refresh the model list.');
    if(response.status===400)throw failure(400,'OpenAI rejected the request. Choose another model with structured output support, or shorten your source and prompt.');
    throw failure(502,'OpenAI is unavailable right now. Try again later.');
  }
  const raw=await response.text();
  if(raw.length>2000000)throw failure(502,'The OpenAI response was too large. Request fewer questions.');
  try{return JSON.parse(raw)}catch{throw failure(502,'OpenAI returned an unreadable response.')}
}
module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return reply(res,405,{error:'Use POST for OpenAI requests.'})}
  if(req.headers['sec-fetch-site']==='cross-site')return reply(res,403,{error:'Use OpenAI from this app.'});
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
    const key=req.headers['x-openai-api-key'];
    if(typeof key!=='string'||!/^[\x21-\x7e]{20,1024}$/.test(key))throw failure(400,'Paste the complete OpenAI API key without spaces or line breaks.');
    if(body.action==='models'){
      const data=await openai('models',key,controller.signal);
      const models=(Array.isArray(data.data)?data.data:[]).filter(m=>supportedModel(m.id)).map(m=>({id:m.id,name:m.id}));
      return reply(res,200,{models});
    }
    if(body.action!=='generate')throw failure(400,'Unknown OpenAI action.');
    if(!supportedModel(body.model))throw failure(400,'Select a supported OpenAI text model.');
    if(typeof body.source!=='string'||!body.source.trim()||body.source.length>30000)throw failure(400,'Provide a topic or source of up to 30,000 characters.');
    if(typeof body.prompt!=='string'||!body.prompt.trim()||body.prompt.length>30000)throw failure(400,'Choose a saved prompt of up to 30,000 characters.');
    if(![0,5,10,15,25].includes(body.count))throw failure(400,'Choose a supported question count.');
    const prompt=body.prompt.replace(/\{\{\s*(question|source|topic)\s*\}\}/gi,()=>body.source);
    const instructions='Create a connected Concept Breakdown Quiz for the supplied source. Follow the saved prompt and source CBQ modes. Return JSON using the supplied schema without code fences. Use plain English and accurate concise explanations. MCQ answers must be option letters (A, B, etc.); respect the option count requested in the prompt. For true_false use a boolean answer, true or false. Fill-blank answers must have nonempty acceptedAnswers. Ordering options must be the same items as the answer sequence; matching pairs need left and right text. Use null for fields that do not apply, including acceptedAnswers outside fill_blank and pairs outside matching. Use sensible section timing and marks. Escape LaTeX backslashes in JSON. Do not invent citations. '+(body.count?'Generate exactly '+body.count+' questions.':'Follow the question count in the saved prompt/source; default to 5, maximum 200.');
    const data=await openai('responses',key,controller.signal,{
      model:body.model,store:false,instructions,
      input:'Saved CBQ prompt:\n'+prompt+'\n\nTopic / source:\n'+body.source,
      max_output_tokens:16384,
      ...(/^(?:gpt-[5-9]|o[34])/.test(body.model)?{reasoning:{effort:'low'}}:{}),
      text:{format:{type:'json_schema',name:'quizflow_cbq',strict:true,schema:quizSchema}}
    });
    const content=(data.output||[]).filter(item=>item.type==='message').flatMap(item=>item.content||[]);
    if(content.some(item=>item.type==='refusal'))throw failure(422,'OpenAI declined this source. Try rephrasing the topic.');
    if(data.status==='incomplete')throw failure(422,data.incomplete_details?.reason==='max_output_tokens'?'The response was cut short. Try fewer questions or a shorter prompt.':'OpenAI could not finish this quiz. Try another topic or model.');
    if(data.status!=='completed')throw failure(422,'OpenAI could not complete this quiz. Try another model or source.');
    const text=content.filter(item=>item.type==='output_text'&&typeof item.text==='string').map(item=>item.text).join('');
    if(!text.trim())throw failure(422,'OpenAI returned no quiz. Try another model or source.');
    let quiz;try{quiz=omitNull(JSON.parse(text))}catch{throw failure(422,'OpenAI returned invalid JSON. Try fewer questions or another model.')}
    if(!quiz||!Array.isArray(quiz.sections))throw failure(422,'OpenAI returned an invalid quiz structure. Try another prompt or model.');
    const count=quiz.sections.reduce((n,s)=>n+(Array.isArray(s?.questions)?s.questions.length:0),0);
    if(!count||count>200)throw failure(422,'OpenAI returned an empty or oversized quiz. Try fewer questions.');
    return reply(res,200,{quiz,model:body.model,usage:{inputTokens:data.usage?.input_tokens||0,outputTokens:data.usage?.output_tokens||0}});
  }catch(error){
    if(error.name!=='AbortError'&&!error.status)return reply(res,502,networkFailure('OpenAI',error));
    return reply(res,error.name==='AbortError'?504:error.status||502,{error:error.name==='AbortError'?'The OpenAI request timed out. Try again, or use a faster model and fewer questions.':error.status?error.message:'The app server could not reach OpenAI. Check server network access and try again.'});
  }finally{clearTimeout(timeout);res.removeListener('close',disconnect)}
};
