import {test,after,before} from 'node:test';import assert from 'node:assert/strict';
process.env.NODE_ENV='test';process.env.OWNER_TOKEN='test-owners';process.env.ACCESS_TOKEN='test-access';process.env.ADMIN_TOKEN='test-admin';process.env.SESSION_SECRET='test-secret';process.env.DEMO_MODE='true';process.env.DATA_DIR='/tmp/player2-test-'+process.pid;
const {mkdir,writeFile}=await import('node:fs/promises');await mkdir(process.env.DATA_DIR,{recursive:true});await writeFile(process.env.DATA_DIR+'/google.json',JSON.stringify({refresh_token:'fake-test-refresh'}));
const {server}=await import('../server.mjs');let base,cookie;
before(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;});after(()=>server.close());
test('Interface, assets, photos and uploads are protected',async()=>{for(const path of ['/','/app.js','/style.css','/api/photos','/api/game','/game.js','/api/photos/abc/download','/admin/connect?key=wrong','/accesso/wrong'])assert.equal((await fetch(base+path)).status,404);assert.equal((await fetch(base+'/api/upload',{method:'POST'})).status,404);});
test('NFC exchanges token for an HttpOnly session and clean URL',async()=>{const r=await fetch(base+'/accesso/test-access',{redirect:'manual'});assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/');assert.match(r.headers.get('set-cookie'),/HttpOnly/);cookie=r.headers.get('set-cookie').split(';')[0];assert.equal((await fetch(base,{headers:{cookie}})).status,200);assert.deepEqual(await(await fetch(base+'/api/photos',{headers:{cookie}})).json(),{files:[],demo:true});});
test('Forged session and cross-origin uploads are rejected',async()=>{assert.equal((await fetch(base,{headers:{cookie:'p2=9999999999999.forged'}})).status,404);assert.equal((await fetch(base+'/api/upload',{method:'POST',headers:{cookie,origin:'https://evil.example'}})).status,403);});
test('OAuth callback requires matching state cookie',async()=>{assert.equal((await fetch(base+'/oauth/callback?code=bad&state=bad')).status,403);});

test('Game API preserves identity, protects mutations and handles competing requests',async()=>{
 const home=await fetch(base,{headers:{cookie}});const identity=home.headers.get('set-cookie').split(';')[0];const headers={cookie:cookie+'; '+identity,origin:'http://localhost:3000','Content-Type':'application/json'};
 const post=(path,value)=>fetch(base+'/api/game/'+path,{method:'POST',headers,body:JSON.stringify(value)});
 assert.equal((await post('nickname',{nickname:'Hero test'})).status,200);
 const draws=await Promise.all([post('draw',{difficulty:'easy'}),post('draw',{difficulty:'hard'})]);assert.deepEqual(draws.map(r=>r.status).sort(),[200,409]);
 const state=await(await fetch(base+'/api/game',{headers})).json();assert.equal(state.nickname,'Hero test');
 const completed=await(await post('finish',{attemptId:state.active.attemptId,action:'complete'})).json();assert.equal(completed.xp,state.active.xp);
 assert.equal((await post('finish',{attemptId:state.active.attemptId,action:'complete'})).status,409);
 assert.equal((await fetch(base+'/api/game/nickname',{method:'POST',headers:{...headers,origin:'https://evil.example'},body:'{}'})).status,403);
});

test('Owners dashboard requires a separate key and never leaks secrets',async()=>{
 for(const path of ['/sposi','/sposi/app.js','/sposi/style.css','/sposi/api/players','/sposi/api/players/1','/sposi/photos/evidence','/sposi/drive/connect','/sposi/accesso/wrong']){
 assert.equal((await fetch(base+path)).status,404);
 assert.equal((await fetch(base+path,{headers:{cookie}})).status,404);
 }
 const entry=await fetch(base+'/sposi/accesso/test-owners',{redirect:'manual'});assert.equal(entry.status,303);assert.equal(entry.headers.get('location'),'/sposi');
 const ownerCookie=entry.headers.get('set-cookie').split(';')[0];assert.match(entry.headers.get('set-cookie'),/HttpOnly/);
 assert.equal((await fetch(base+'/sposi',{headers:{cookie:ownerCookie}})).status,200);
 const summary=await(await fetch(base+'/sposi/api/players',{headers:{cookie:ownerCookie}})).json();assert.ok(summary.players.length);const p=summary.players.find(p=>p.nickname==='Hero test');assert.ok(p);assert.ok(p.completed===1);assert.ok(!JSON.stringify(summary).includes('token_hash'));
 const detail=await(await fetch(base+'/sposi/api/players/'+p.id,{headers:{cookie:ownerCookie}})).json();assert.equal(detail.attempts[0].status,'completed');assert.equal(detail.player.xp,p.xp);
 assert.equal((await fetch(base+'/sposi/api/players/'+p.id+'?before=nope',{headers:{cookie:ownerCookie}})).status,400);
 assert.equal((await fetch(base+'/sposi/api/players',{headers:{cookie:'p2owners=9999999999999.forged'}})).status,404);
 assert.equal((await fetch(base+'/sposi/api/players',{method:'POST',headers:{cookie:ownerCookie}})).status,405);
});

test('Photo bonus validates Drive folder and leaves the quest active on errors',async()=>{
 const original=globalThis.fetch;let broken=false;
 globalThis.fetch=async(url,options)=>{const address=String(url);if(address==='https://oauth2.googleapis.com/token')return Response.json({access_token:'fake',expires_in:3600});if(address.startsWith('https://www.googleapis.com/drive/v3/files/')){if(broken)return Response.json({error:'unavailable'},{status:503});return Response.json({id:address.includes('foreign')?'foreign':'evidence',name:'Foto.jpg',mimeType:'image/jpeg',parents:address.includes('foreign')?['other-folder']:['1mpR9e_Zow1fUADXuoAeSPCeEhvppFuW7']});}return original(url,options);};
 try{const home=await original(base,{headers:{cookie}}),identity=home.headers.get('set-cookie').split(';')[0];const headers={cookie:cookie+'; '+identity,origin:'http://localhost:3000','Content-Type':'application/json'};const post=(path,input)=>original(base+'/api/game/'+path,{method:'POST',headers,body:JSON.stringify(input)});await post('nickname',{nickname:'Foto hero'});let q=(await(await post('draw',{difficulty:'extreme'})).json()).active;
 assert.equal((await post('finish',{attemptId:q.attemptId,action:'complete',photoId:'https://evil.example'})).status,400);
 assert.equal((await post('finish',{attemptId:q.attemptId,action:'complete',photoId:'foreign'})).status,404);
 broken=true;assert.equal((await post('finish',{attemptId:q.attemptId,action:'complete',photoId:'evidence'})).status,502);broken=false;
 let j=await(await post('finish',{attemptId:q.attemptId,action:'complete',photoId:'evidence',photoTitle:'Titolo mio',bonus:999999})).json();assert.equal(j.xp,240);assert.equal(j.history[0].photoTitle,'Titolo mio');
 q=(await(await post('draw',{difficulty:'easy'})).json()).active;assert.equal((await post('finish',{attemptId:q.attemptId,action:'complete',photoId:'evidence'})).status,409);j=await(await post('finish',{attemptId:q.attemptId,action:'complete'})).json();assert.equal(j.xp,260);
 }finally{globalThis.fetch=original;}
});

test('Privacy and terms are public without opening the private app or creating player cookies',async()=>{
 for(const path of ['/privacy','/termini','/legal/style.css']){const r=await fetch(base+path);assert.equal(r.status,200);assert.equal(r.headers.get('set-cookie'),null);assert.equal((await fetch(base+path,{method:'HEAD'})).status,200);assert.equal((await fetch(base+path,{method:'POST'})).status,405);}
 assert.equal((await fetch(base)).status,404);assert.equal((await fetch(base+'/api/game')).status,404);assert.equal((await fetch(base+'/api/photos')).status,404);assert.equal((await fetch(base+'/sposi')).status,404);assert.equal((await fetch(base+'/legal/../server.mjs')).status,404);
});
