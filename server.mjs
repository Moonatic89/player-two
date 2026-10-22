import http from 'node:http';
import { createGame } from './game.mjs';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { Readable } from 'node:stream';
const env=process.env, port=Number(env.PORT||3000), origin=env.APP_ORIGIN||`http://localhost:${port}`;
const folder=env.DRIVE_FOLDER_ID||'1mpR9e_Zow1fUADXuoAeSPCeEhvppFuW7', demo=env.DEMO_MODE==='true';
if(!env.ACCESS_TOKEN||!env.SESSION_SECRET||!env.ADMIN_TOKEN) throw Error('Configure ACCESS_TOKEN, SESSION_SECRET and ADMIN_TOKEN');
const data=env.DATA_DIR||'./data', secure=origin.startsWith('https:');
await mkdir(data,{recursive:true,mode:0o700});
const game=createGame(`${data}/player2.sqlite`);
let credentials={}; try{credentials=JSON.parse(await readFile(`${data}/google.json`,'utf8'));}catch{}
let cachedToken, tokenExpiry=0;
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const sign=s=>createHmac('sha256',env.SESSION_SECRET).update(s).digest('hex');
const cookies=req=>Object.fromEntries((req.headers.cookie||'').split(';').map(s=>s.trim().split('=')));
function validSession(req){const v=cookies(req).p2||'', [expires,signature]=v.split('.');return Number(expires)>Date.now()&&equal(signature,sign(expires+env.ACCESS_TOKEN));}
function cookie(name,value,maxAge){return `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure?'; Secure':''}`;}
function reply(res,status,body,type='application/json'){res.writeHead(status,{'Content-Type':type});res.end(type==='application/json'?JSON.stringify(body):body);}
function redirect(res,url,c){res.writeHead(303,{Location:url,...(c?{'Set-Cookie':c}:{})});res.end();}
async function body(req,limit){let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>limit)throw Object.assign(Error('Foto troppo grande (massimo 25 MB).'),{status:413});chunks.push(chunk);}return Buffer.concat(chunks);}
async function access(){if(cachedToken&&tokenExpiry>Date.now())return cachedToken;if(!credentials.refresh_token)throw Object.assign(Error('La galleria sta aspettando il collegamento a Google Drive.'),{status:503});const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:credentials.refresh_token,grant_type:'refresh_token'}),signal:AbortSignal.timeout(15000)});const j=await r.json();if(!r.ok)throw Object.assign(Error('Il collegamento a Google Drive deve essere rinnovato.'),{status:503});cachedToken=j.access_token;tokenExpiry=Date.now()+(j.expires_in-60)*1000;return cachedToken;}
async function drive(path,options={}){const r=await fetch(path.startsWith('https:')?path:`https://www.googleapis.com/drive/v3/${path}`,{...options,headers:{...options.headers,Authorization:`Bearer ${await access()}`},signal:AbortSignal.timeout(60000)});if(!r.ok){await r.text();throw Object.assign(Error('Google Drive non è disponibile. Riprova tra poco.'),{status:502});}return r;}
function startGoogle(res){if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET)return reply(res,503,'Credenziali Google ancora da configurare.','text/plain');const state=randomBytes(32).toString('hex');const query=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:origin+'/oauth/callback',response_type:'code',scope:'https://www.googleapis.com/auth/drive',access_type:'offline',prompt:'consent',state});return redirect(res,'https://accounts.google.com/o/oauth2/v2/auth?'+query,cookie('oauth',state,600));}
async function photoMetadata(id){
 const meta=await(await drive(`files/${id}?fields=id,name,mimeType,parents,thumbnailLink,trashed`)).json();
 if(meta.trashed||!meta.parents?.includes(folder)||!meta.mimeType?.startsWith('image/'))throw Object.assign(Error('Foto non trovata nella galleria.'),{status:404});return meta;
}
async function sendPhoto(res,id,download=false){
 const meta=await photoMetadata(id);let r;
 if(!download&&meta.thumbnailLink){const thumb=new URL(meta.thumbnailLink);if(thumb.protocol==='https:'&&(/(^|\.)googleusercontent\.com$/.test(thumb.hostname)||/(^|\.)google\.com$/.test(thumb.hostname)))r=await drive(thumb.href);}
 r ||=await drive(`files/${id}?alt=media`);res.setHeader('Content-Type',r.headers.get('content-type')||meta.mimeType);
 if(download)res.setHeader('Content-Disposition',`attachment; filename="photo"; filename*=UTF-8''${encodeURIComponent(meta.name).replace(/'/g,'%27')}`);Readable.fromWeb(r.body).pipe(res);
}
function imageType(b){if(b[0]===255&&b[1]===216&&b[2]===255)return'image/jpeg';if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return'image/png';if(b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP')return'image/webp';if(b.toString('ascii',0,6).match(/^GIF8[79]a$/))return'image/gif';if(b.toString('ascii',4,8)==='ftyp'&&/heic|heix|hevc|mif1|msf1/.test(b.toString('ascii',8,32)))return'image/heic';return null;}
const uploads=new Map();
export const server=http.createServer(async(req,res)=>{res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");try{
const url=new URL(req.url,origin), path=url.pathname;
if(path==='/health')return reply(res,200,{ok:true});
const legalFiles=new Map([['/privacy',['privacy.html','text/html; charset=utf-8']],['/termini',['termini.html','text/html; charset=utf-8']],['/legal/style.css',['style.css','text/css; charset=utf-8']]]);
if(legalFiles.has(path)){
 if(!['GET','HEAD'].includes(req.method))return reply(res,405,'Metodo non consentito','text/plain');
 const [file,type]=legalFiles.get(path);return reply(res,200,await readFile(new URL('./public/legal/'+file,import.meta.url)),type);
}

if(path.startsWith('/sposi/accesso/')&&req.method==='GET'){
 if(!env.OWNER_TOKEN||!equal(path.slice('/sposi/accesso/'.length),env.OWNER_TOKEN))return reply(res,404,'Non trovato','text/plain');
 const expires=String(Date.now()+30*86400000);return redirect(res,'/sposi',cookie('p2owners',expires+'.'+sign('owners:'+expires+env.OWNER_TOKEN),30*86400));
}
if(path==='/sposi'||path.startsWith('/sposi/')){
 const [expires,signature]=(cookies(req).p2owners||'').split('.');
 if(!env.OWNER_TOKEN||Number(expires)<=Date.now()||!Number.isFinite(Number(expires))||!equal(signature,sign('owners:'+expires+env.OWNER_TOKEN)))return reply(res,404,'Non trovato','text/plain');
 const resetRoute=path.match(/^\/sposi\/api\/players\/(\d+)\/reset(\/prepare)?$/);
 if(resetRoute&&req.method==='POST'){
  if(req.headers.origin!==origin)return reply(res,403,{error:'Richiesta non valida.'});
  const id=Number(resetRoute[1]);if(!Number.isSafeInteger(id)||id<1)return reply(res,400,{error:'Invitato non valido.'});
  let input;try{input=JSON.parse((await body(req,4096)).toString());}catch(e){if(e.status)throw e;return reply(res,400,{error:'Dati non validi.'});}
  if(!input||typeof input!=='object')return reply(res,400,{error:'Dati non validi.'});
  const session=cookies(req).p2owners;
  return reply(res,200,resetRoute[2]?game.prepareReset(id,session):game.resetProgress(id,input.confirmationToken,input.nickname,session));
 }
 if(req.method!=='GET')return reply(res,405,'Metodo non consentito','text/plain');
 if(path==='/sposi/drive/connect')return startGoogle(res);
 const ownerPhoto=path.match(/^\/sposi\/photos\/([a-zA-Z0-9_-]{1,200})$/);if(ownerPhoto)return await sendPhoto(res,ownerPhoto[1]);
 if(path==='/sposi/api/players')return reply(res,200,game.overview());
 const detail=path.match(/^\/sposi\/api\/players\/(\d+)$/);
 if(detail){const id=Number(detail[1]),before=Number(url.searchParams.get('before')||Number.MAX_SAFE_INTEGER);if(!Number.isSafeInteger(id)||!Number.isSafeInteger(before)||before<1)return reply(res,400,{error:'Pagina non valida.'});return reply(res,200,game.details(id,before));}
 const assets={'/sposi':['owners.html','text/html; charset=utf-8'],'/sposi/':['owners.html','text/html; charset=utf-8'],'/sposi/app.js':['owners.js','text/javascript; charset=utf-8'],'/sposi/style.css':['style.css','text/css; charset=utf-8']};
 if(assets[path]){const [file,type]=assets[path];return reply(res,200,await readFile(new URL('./public/'+file,import.meta.url)),type);}
 return reply(res,404,'Non trovato','text/plain');
}

if(path.startsWith('/accesso/')&&req.method==='GET'){if(!equal(path.slice(9),env.ACCESS_TOKEN))return reply(res,404,'Non trovato','text/plain');const exp=String(Date.now()+30*86400000);return redirect(res,'/',cookie('p2',exp+'.'+sign(exp+env.ACCESS_TOKEN),30*86400));}
if(path==='/admin/connect'&&req.method==='GET'){
if(!equal(url.searchParams.get('key'),env.ADMIN_TOKEN))return reply(res,404,'Non trovato','text/plain');
if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET)return reply(res,503,'Credenziali Google ancora da configurare.','text/plain');
return startGoogle(res);}
if(path==='/oauth/callback'&&req.method==='GET'){
if(!cookies(req).oauth||!equal(url.searchParams.get('state'),cookies(req).oauth))return reply(res,403,'Autorizzazione non valida.','text/plain');
if(!url.searchParams.get('code'))return reply(res,400,'Autorizzazione annullata.','text/plain');
const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({code:url.searchParams.get('code'),client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,redirect_uri:origin+'/oauth/callback',grant_type:'authorization_code'}),signal:AbortSignal.timeout(15000)});const j=await r.json();if(!r.ok||!j.refresh_token)throw Error('Autorizzazione Google non completata.');
await writeFile(`${data}/google.tmp`,JSON.stringify({refresh_token:j.refresh_token}),{mode:0o600});await rename(`${data}/google.tmp`,`${data}/google.json`);credentials={refresh_token:j.refresh_token};cachedToken=null;res.setHeader('Set-Cookie',cookie('oauth','',0));return reply(res,200,'Google Drive collegato. Ora puoi aprire il link NFC.','text/plain');}
if(!validSession(req))return reply(res,404,'Non trovato','text/plain');
if(req.method==='POST'&&req.headers.origin!==origin)return reply(res,403,{error:'Richiesta non valida.'});
const player=game.identify(cookies(req).p2player,req.method==='GET'&&path==='/');
if(player.token)res.setHeader('Set-Cookie',cookie('p2player',player.token,365*86400));
if(path==='/api/game'&&req.method==='GET')return reply(res,200,game.state(player.id));
if(['/api/game/nickname','/api/game/draw','/api/game/finish'].includes(path)&&req.method==='POST'){
let input;try{input=JSON.parse((await body(req,4096)).toString());}catch(e){if(e.status)throw e;return reply(res,400,{error:'Dati non validi.'});}
if(!input||typeof input!=='object')return reply(res,400,{error:'Dati non validi.'});
let photo=null;
if(path.endsWith('/finish')&&input.photoId){
 if(input.action!=='complete'||typeof input.photoId!=='string'||!/^[a-zA-Z0-9_-]{1,200}$/.test(input.photoId))return reply(res,400,{error:'Foto non valida.'});
 const active=game.state(player.id).active;if(!active||active.attemptId!==input.attemptId)return reply(res,409,{error:'Questa quest non è più attiva.'});
 if(input.photoTitle!==undefined&&(typeof input.photoTitle!=='string'||[...input.photoTitle].length>120||/[\p{C}]/u.test(input.photoTitle)))return reply(res,400,{error:'Titolo non valido (massimo 120 caratteri).'});
 await photoMetadata(input.photoId);photo={id:input.photoId,title:input.photoTitle?.trim()||active.title};
}
const result=path.endsWith('/nickname')?game.nickname(player.id,input.nickname):path.endsWith('/draw')?game.draw(player.id,input.difficulty):game.finish(player.id,input.attemptId,input.action,photo);return reply(res,200,result);}
if(req.method==='GET'&&['/','/app.js','/game.js','/style.css'].includes(path)){const filename=path==='/'?'index.html':path.slice(1);return reply(res,200,await readFile(new URL('./public/'+filename,import.meta.url)),path==='/'?'text/html; charset=utf-8':path.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8');}
if(path==='/api/photos'&&req.method==='GET'){
if(demo)return reply(res,200,{files:[],demo:true});
const page=url.searchParams.get('page')||'';if(page.length>1000)return reply(res,400,{error:'Pagina non valida'});
const params=new URLSearchParams({q:`'${folder.replace(/'/g,"\\'")}' in parents and trashed = false and mimeType contains 'image/'`,fields:'nextPageToken,files(id,name,mimeType,createdTime)',orderBy:'createdTime desc',pageSize:'60',...(page?{pageToken:page}:{})});const listing=await(await drive('files?'+params)).json();const titles=game.photoTitles(listing.files.map(f=>f.id));listing.files=listing.files.map(f=>({...f,...titles[f.id]}));return reply(res,200,listing);}
const match=path.match(/^\/api\/photos\/([a-zA-Z0-9_-]+)(\/download)?$/);
if(match&&req.method==='GET'){
return await sendPhoto(res,match[1],!!match[2]);}

if(path==='/api/upload'&&req.method==='POST'){
if(demo)return reply(res,409,{error:'Questa è una preview: le foto non vengono salvate.'});
const now=Date.now(),key=player.id, prev=uploads.get(key)||{count:0,start:now};if(now-prev.start>3600000){prev.start=now;prev.count=0;}if(prev.count>=150)return reply(res,429,{error:'Troppi caricamenti. Riprova tra un’ora.'});prev.count++;uploads.set(key,prev);for(const[k,v]of uploads)if(now-v.start>3600000)uploads.delete(k);
const bytes=await body(req,25*1024*1024),mime=imageType(bytes);if(!mime)return reply(res,415,{error:'Scegli una foto JPEG, PNG, WebP, GIF o HEIC.'});
let name;try{name=decodeURIComponent(req.headers['x-file-name']||'foto.jpg');}catch{return reply(res,400,{error:'Nome non valido'});}name=name.replace(/[\x00-\x1f/\\]/g,'_').slice(0,180)||'foto.jpg';
const boundary=randomBytes(24).toString('hex'), meta=JSON.stringify({name,parents:[folder]});const multipart=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`),bytes,Buffer.from(`\r\n--${boundary}--\r\n`)]);const r=await drive('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',{method:'POST',headers:{'Content-Type':`multipart/related; boundary=${boundary}`},body:multipart});return reply(res,201,await r.json());}
reply(res,404,'Non trovato','text/plain');
}catch(e){if(!res.headersSent)reply(res,e.status||500,{error:e.status?e.message:'Qualcosa non ha funzionato. Riprova tra poco.'});else res.destroy();console.error('Request failed:',e.status||500);}});
if(env.NODE_ENV!=='test')server.listen(port,'0.0.0.0',()=>console.log(`Player 2 listening on ${port}`));
