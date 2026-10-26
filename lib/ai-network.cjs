/* Safe connection diagnostics: never expose provider payloads or credentials. */
module.exports=function networkFailure(provider,error){
  const codes=[error?.code,error?.cause?.code,...(error?.cause?.errors||[]).map(item=>item?.code)];
  if(codes.some(code=>code==='EACCES'||code==='EPERM'))return {code:'NETWORK_DENIED',error:'The server is denied outbound network access. Start npm run dev in a regular Windows terminal outside Codex, then open http://127.0.0.1:3000, or use your Vercel deployment. '+provider+' has not verified this key.'};
  if(codes.some(code=>/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code||'')))return {code:'NETWORK_TLS',error:'The server could not verify '+provider+'’s TLS certificate. Check your network’s trusted certificates or proxy configuration. Keep certificate verification enabled.'};
  if(codes.some(code=>code==='ENOTFOUND'||code==='EAI_AGAIN'))return {code:'NETWORK_DNS',error:'The server could not resolve '+provider+'’s address. Check its internet connection, DNS or proxy configuration.'};
  return {code:'NETWORK_CONNECTION',error:'The app server could not connect to '+provider+'. Check server internet access, firewall or proxy configuration. Your key could not be verified.'};
};
