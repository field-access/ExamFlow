/* Vercel Function. Per-request user keys only; no shared key, storage, or logging. */
const BASE = 'https://generativelanguage.googleapis.com/v1beta/';
const networkFailure=require('../lib/ai-network.cjs');
const modelCatalog=require('../gemini-models.json');
function tierFor(id){return modelCatalog.freeTierModels.includes(id)?'free':modelCatalog.paidOnlyModels.includes(id)?'paid':'unverified'}
const questionSchema = {
  type:'object', required:['type','question','answer','explanation'],
  properties:{
    type:{type:'string',enum:['mcq','true_false','fill_blank','match','drag_drop','ordering']},
    question:{type:'string'}, explanation:{type:'string'}, hint:{type:'string'},
    options:{type:'array',items:{type:'string'}},
    answer:{anyOf:[{type:'string'},{type:'integer'},{type:'boolean'},{type:'array',items:{type:'string'}}]},
    acceptedAnswers:{type:'array',items:{type:'string'}},
    pairs:{type:'array',items:{type:'object',properties:{left:{type:'string'},right:{type:'string'}},required:['left','right']}},
    marks:{type:'number'},negativeMarks:{type:'number'}
  }
};
const quizSchema = {
  type:'object',required:['name','sections'],properties:{
    name:{type:'string'},sections:{type:'array',minItems:1,items:{
      type:'object',required:['name','questions'],properties:{
        name:{type:'string'},timeMinutes:{type:'integer'},marks:{type:'number'},negativeMarks:{type:'number'},
        questions:{type:'array',minItems:1,maxItems:200,items:questionSchema}
      }
    }}
  }
};
function reply(res,status,data){if(!res.destroyed)res.status(status).json(data)}
function failure(status,message,code){const error=new Error(message);error.status=status;error.code=code;return error}
async function google(path,key,signal,body){
  const response=await fetch(BASE+path,{
    method:body?'POST':'GET',headers:{'Content-Type':'application/json','x-goog-api-key':key},
    ...(body?{body:JSON.stringify(body)}:{}),signal
  });
  if(!response.ok){
    // Classify known provider errors without exposing their raw message or credentials.
    const raw=await response.text();let detail={};
    if(raw.length<=2000000){try{detail=JSON.parse(raw).error||{}}catch{}}
    const reasons=(Array.isArray(detail.details)?detail.details:[]).map(item=>item?.reason).filter(reason=>typeof reason==='string');
    const message=typeof detail.message==='string'?detail.message:'';
    if(/leaked|compromised/i.test(message))throw failure(401,'Google blocked this key because it was reported as leaked. Replace it in Google AI Studio and reconnect.','KEY_REVOKED');
    if(reasons.some(r=>/API_KEY_(INVALID|EXPIRED)/.test(r))||/API key not valid|invalid api key|expired api key/i.test(message))throw failure(401,'Google rejected this API key. Copy a fresh Gemini key from Google AI Studio and reconnect.','KEY_INVALID');
    if(reasons.includes('SERVICE_DISABLED'))throw failure(403,'The Gemini API is disabled for this project. Enable it in Google Cloud or create a Gemini key in Google AI Studio.','SERVICE_DISABLED');
    if(reasons.some(r=>/API_KEY_.*BLOCKED/.test(r)))throw failure(403,'This key’s API or application restrictions block the app server. Allow Gemini API access and check server/IP restrictions in Google Cloud.','KEY_RESTRICTED');
    if(response.status===401||response.status===403)throw failure(401,'Google denied access. Check the auth key’s service account permissions, project access and restrictions in Google AI Studio or Cloud.','KEY_ACCESS_DENIED');
    if(response.status===429)throw failure(429,'Gemini quota or rate limit reached. Check your Google AI project billing and limits, or try later.','QUOTA_LIMIT');
    if(response.status===404)throw failure(400,'That model is no longer available. Reconnect to refresh the model list.');
    if(response.status===400)throw failure(400,'Gemini rejected the request. Check the key, choose another text model, or shorten the source and prompt.');
    throw failure(502,'Gemini is unavailable right now. Try again later.');
  }
  const raw=await response.text();
  if(raw.length>2000000)throw failure(502,'The Gemini response was too large. Request fewer questions.');
  try{return JSON.parse(raw)}catch{throw failure(502,'Gemini returned an unreadable response.')}
}
module.exports = async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return reply(res,405,{error:'Use POST for Gemini requests.'})}
  if(req.headers['sec-fetch-site']==='cross-site')return reply(res,403,{error:'Use Gemini from this app.'});
  if(!String(req.headers['content-type']||'').includes('application/json'))return reply(res,415,{error:'Send a JSON request.'});
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),52000);
  const disconnect=()=>{if(!res.writableEnded)controller.abort()};
  res.on('close',disconnect);
  try{
    let body=req.body;
    if(Buffer.isBuffer(body))body=body.toString('utf8');
    if(typeof body==='string'){if(body.length>100000)throw failure(413,'The source and prompt are too large.');try{body=JSON.parse(body)}catch{throw failure(400,'Invalid request JSON.')}}
    if(!body||typeof body!=='object'||Array.isArray(body)||JSON.stringify(body).length>100000)throw failure(400,'Invalid generation request.');
    const key=req.headers['x-gemini-api-key'];
    if(typeof key!=='string'||!/^[\x21-\x7e]{20,1024}$/.test(key))throw failure(400,'Paste the complete Gemini API key without spaces or line breaks.','KEY_FORMAT');
    if(body.action==='models'){
      let page='',models=[];
      for(let i=0;i<3;i++){
        const data=await google('models?pageSize=1000'+(page?'&pageToken='+encodeURIComponent(page):''),key,controller.signal);
        models.push(...(data.models||[]));page=data.nextPageToken;if(!page)break;
      }
      models=models.filter(m=>/^models\/gemini-[a-z0-9._-]+$/i.test(m.name||'')&&(m.supportedGenerationMethods||m.supportedActions||[]).includes('generateContent')&&!/image|tts|audio|live|robotics|computer-use/i.test(m.name)).map(m=>({id:m.name.slice(7),name:m.displayName||m.name.slice(7),tier:tierFor(m.name.slice(7))}));
      return reply(res,200,{models,catalogCheckedAt:modelCatalog.checkedAt});
    }
    if(body.action!=='generate')throw failure(400,'Unknown Gemini action.');
    if(typeof body.model!=='string'||!/^gemini-[a-z0-9._-]{1,100}$/i.test(body.model))throw failure(400,'Select a Gemini model.');
    if(body.freeTierOnly===true&&tierFor(body.model)!=='free')throw failure(400,'This model is not in the published free-tier list. Choose a free-tier model or turn off the filter.','MODEL_TIER');
    if(typeof body.source!=='string'||!body.source.trim()||body.source.length>30000)throw failure(400,'Provide a topic or source of up to 30,000 characters.');
    if(typeof body.prompt!=='string'||!body.prompt.trim()||body.prompt.length>30000)throw failure(400,'Choose a saved prompt of up to 30,000 characters.');
    if(![0,5,10,15,25].includes(body.count))throw failure(400,'Choose a supported question count.');
    const prompt=body.prompt.replace(/\{\{\s*(question|source|topic)\s*\}\}/gi,()=>body.source);
    const instructions='Create a connected Concept Breakdown Quiz for the supplied source. Follow the saved prompt and source CBQ modes. Return a JSON object using the supplied schema, without code fences. Use plain English and accurate concise explanations. MCQ answers must be option letters (A, B, etc.); respect the option count requested in the prompt. Fill-blank answers must have acceptedAnswers. Ordering options must be the same items as the answer sequence; matching pairs need left and right text. Escape LaTeX backslashes in JSON. Do not invent citations. '+(body.count?'Generate exactly '+body.count+' questions.':'Follow the question count in the saved prompt/source; default to 5, maximum 200.');
    const data=await google('models/'+encodeURIComponent(body.model)+':generateContent',key,controller.signal,{
      systemInstruction:{parts:[{text:instructions}]},
      contents:[{role:'user',parts:[{text:'Saved CBQ prompt:\n'+prompt+'\n\nTopic / source:\n'+body.source}]}],
      generationConfig:{maxOutputTokens:16384,responseFormat:{text:{mimeType:'APPLICATION_JSON',schema:quizSchema}}}
    });
    const candidate=data.candidates?.[0];
    if(data.promptFeedback?.blockReason)throw failure(422,'Gemini declined this source. Try rephrasing the topic.');
    if(candidate?.finishReason==='MAX_TOKENS')throw failure(422,'The response was cut short. Try fewer questions or a shorter prompt.');
    if(candidate?.finishReason&&candidate.finishReason!=='STOP')throw failure(422,'Gemini could not finish this quiz. Try another topic or model.');
    const text=(candidate?.content?.parts||[]).filter(p=>!p.thought&&typeof p.text==='string').map(p=>p.text).join('');
    if(!text.trim())throw failure(422,'Gemini returned no quiz. Try another model or source.');
    let quiz;try{quiz=JSON.parse(text)}catch{throw failure(422,'Gemini returned invalid JSON. Try fewer questions or another model.');}
    if(!quiz||!Array.isArray(quiz.sections))throw failure(422,'Gemini returned an invalid quiz structure. Try another prompt or model.');
    const count=quiz.sections.reduce((n,s)=>n+(Array.isArray(s?.questions)?s.questions.length:0),0);
    if(!count||count>200)throw failure(422,'Gemini returned an empty or oversized quiz. Try fewer questions.');
    return reply(res,200,{quiz,model:body.model,usage:{inputTokens:data.usageMetadata?.promptTokenCount||0,outputTokens:data.usageMetadata?.candidatesTokenCount||0}});
  }catch(error){
    if(error.name!=='AbortError'&&!error.status)return reply(res,502,networkFailure('Gemini',error));
    return reply(res,error.name==='AbortError'?504:error.status||502,{error:error.name==='AbortError'?'The Gemini request timed out. Try again, or use a faster model and fewer questions.':error.status?error.message:'The app server could not reach Google. Check server network access and try again.',...(error.code?{code:error.code}:{})});
  }finally{clearTimeout(timeout);res.removeListener('close',disconnect)}
};
