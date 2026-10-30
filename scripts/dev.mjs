/* Local, same-origin server for the study app and project prompt JSON. */
import http from 'node:http';
import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promptFileRequest } from './prompt-file.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const publicRoot=await realpath(path.join(root,'public')).catch(()=>null);
if(!publicRoot){console.error('Run npm run dev to build and start the app.');process.exit(1)}
const port=Number(process.env.PORT||3000);
if(!Number.isInteger(port)||port<1||port>65535){console.error('PORT must be a number from 1 to 65535.');process.exit(1)}
const hosts=new Set(['127.0.0.1:'+port,'localhost:'+port]);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon','.woff2':'font/woff2','.woff':'font/woff'};
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data))}
const server=http.createServer(async(req,res)=>{
  if(!hosts.has(req.headers.host)){json(res,403,{error:'Open the app at http://127.0.0.1:'+port+'.'});return}
  if(req.headers.origin&&!['http://127.0.0.1:'+port,'http://localhost:'+port].includes(req.headers.origin)){json(res,403,{error:'Open the app from this local server.'});return}
  try{
    const pathname=new URL(req.url,'http://127.0.0.1:'+port).pathname;
    if(pathname==='/api/prompts'){await promptFileRequest(req,res,root,json);return}
    if(pathname.startsWith('/api/')){json(res,404,{error:'This API endpoint does not exist.'});return}
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,{Allow:'GET, HEAD'});res.end();return}
    const relative=decodeURIComponent(pathname==='/'?'/index.html':pathname).replace(/^\/+/, '');
    const candidate=path.resolve(publicRoot,relative);
    if(!candidate.startsWith(publicRoot+path.sep)){res.writeHead(403);res.end();return}
    const target=await realpath(candidate);
    if(!target.startsWith(publicRoot+path.sep)){res.writeHead(403);res.end();return}
    const content=await readFile(target);
    res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(req.method==='HEAD'?undefined:content);
  }catch(error){
    if(res.headersSent){res.end();return}
    if(req.url?.startsWith('/api/'))json(res,500,{error:'The local API server could not process this request.'});
    else{res.writeHead(error.code==='ENOENT'?404:400);res.end('Page unavailable. Run npm run dev to rebuild the app.')}
  }
});
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'Port '+port+' is already in use. Close the other server or choose a different PORT.':'The local server could not start.');process.exitCode=1});
server.listen(port,'127.0.0.1',()=>console.log('QuizFlow is running at http://127.0.0.1:'+port+' — keep this terminal open.'));
