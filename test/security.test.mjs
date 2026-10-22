import {test,after,before} from 'node:test';import assert from 'node:assert/strict';
process.env.NODE_ENV='test';process.env.ACCESS_TOKEN='test-access';process.env.ADMIN_TOKEN='test-admin';process.env.SESSION_SECRET='test-secret';process.env.DEMO_MODE='true';process.env.DATA_DIR='/tmp/player2-test-'+process.pid;
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
