import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGame} from '../game.mjs';
import {quests} from '../quests.mjs';

test('Catalog contains exactly 30 Novizio, 15 Avventuriero, 10 Maestro, 5 Saggio quests',()=>{
 for(const [d,n] of [['easy',30],['medium',15],['hard',10],['extreme',5]])assert.equal(quests.filter(q=>q.difficulty===d).length,n);
 assert.equal(new Set(quests.map(q=>q.title)).size,60);
});
test('A profile survives network changes and nicknames do not change XP',()=>{
 const game=createGame(':memory:');try{const p=game.identify();assert.equal(game.identify(p.token).id,p.id);game.nickname(p.id,'Maga turchese');const q=game.draw(p.id,'hard').active;game.finish(p.id,q.attemptId,'complete');assert.equal(game.nickname(p.id,'Nuovo nome').xp,80);assert.equal(game.identify('forged').id!==p.id,true);}finally{game.close();}
});
test('Exclusive active assignments, stale confirmations and foreign attempts are rejected',()=>{
 const game=createGame(':memory:');try{const a=game.identify(),b=game.identify();game.nickname(a.id,'Player A');game.nickname(b.id,'Player B');const qa=game.draw(a.id,'easy').active,qb=game.draw(b.id,'easy').active;assert.notEqual(qa.id,qb.id);assert.throws(()=>game.draw(a.id,'hard'));assert.throws(()=>game.finish(b.id,qa.attemptId,'complete'));game.finish(a.id,qa.attemptId,'complete');assert.throws(()=>game.finish(a.id,qa.attemptId,'complete'));assert.equal(game.state(a.id).xp,20);}finally{game.close();}
});
test('Abandoned and completed quests never recur for their player but are released to others',()=>{
 const game=createGame(':memory:');try{const a=game.identify(),b=game.identify();game.nickname(a.id,'Player A');game.nickname(b.id,'Player B');const ids=new Set();for(let i=0;i<30;i++){const q=game.draw(a.id,'easy').active;assert.ok(!ids.has(q.id));ids.add(q.id);game.finish(a.id,q.attemptId,i%2?'complete':'abandon');}assert.equal(game.state(a.id).available.easy,0);assert.throws(()=>game.draw(a.id,'easy'));assert.equal(game.state(b.id).available.easy,30);assert.ok(ids.has(game.draw(b.id,'easy').active.id));}finally{game.close();}
});
test('Penalties are exactly one quarter of the reward, capped at the player XP',()=>{
 const game=createGame(':memory:');try{const a=game.identify();game.nickname(a.id,'Player A');let q=game.draw(a.id,'hard').active;game.finish(a.id,q.attemptId,'abandon');assert.equal(game.state(a.id).xp,0);q=game.draw(a.id,'hard').active;game.finish(a.id,q.attemptId,'complete');for(const [d,expected]of [['easy',75],['medium',65],['hard',45]]){q=game.draw(a.id,d).active;assert.equal(game.finish(a.id,q.attemptId,'abandon').xp,expected);}}finally{game.close();}
});
test('Database preserves identity and quest history across restart',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises');const dir=await mkdtemp('/tmp/player2-db-');try{let game=createGame(dir+'/game.sqlite');const p=game.identify();game.nickname(p.id,'Persistente');const q=game.draw(p.id,'medium').active;game.finish(p.id,q.attemptId,'abandon');game.close();game=createGame(dir+'/game.sqlite');assert.equal(game.identify(p.token).id,p.id);assert.equal(game.state(p.id).nickname,'Persistente');assert.equal(game.state(p.id).available.medium,14);game.close();}finally{await rm(dir,{recursive:true,force:true});}
});

test('Photo completion grants a server-calculated 50% bonus and cannot reuse evidence',()=>{
 const g=createGame(':memory:');try{const p=g.identify();g.nickname(p.id,'Fotografo');let q=g.draw(p.id,'extreme').active;let state=g.finish(p.id,q.attemptId,'complete',{id:'image1',title:'Vittoria epica'});assert.equal(state.xp,240);assert.equal(state.history[0].photoBonus,80);assert.equal(state.history[0].photoTitle,'Vittoria epica');assert.throws(()=>g.finish(p.id,q.attemptId,'complete',{id:'image2',title:'Bis'}));q=g.draw(p.id,'easy').active;assert.throws(()=>g.finish(p.id,q.attemptId,'complete',{id:'image1',title:'Riutilizzo'}));assert.equal(g.state(p.id).active.attemptId,q.attemptId);assert.equal(g.finish(p.id,q.attemptId,'complete').xp,260);assert.equal(g.photoTitles(['image1']).image1.photoTitle,'Vittoria epica');}finally{g.close();}
});
test('Migration keeps exactly 60 IDs, prior scores, active reward and completion exclusions',async()=>{
 const {DatabaseSync}=await import('node:sqlite');const {mkdtemp,rm}=await import('node:fs/promises');const dir=await mkdtemp('/tmp/player2-migration-');const path=dir+'/game.sqlite';try{
 let g=createGame(path);const p=g.identify();g.nickname(p.id,'Vecchio profilo');g.close();let db=new DatabaseSync(path);
 db.prepare("UPDATE quests SET difficulty='medium',xp=40 WHERE id LIKE 'medium-%'").run();
 db.prepare("INSERT INTO attempts(player_id,quest_id,status,started_at,xp_delta) VALUES(?,'medium-16','completed',?,40)").run(p.id,Date.now());
 db.prepare("INSERT INTO attempts(player_id,quest_id,status,started_at) VALUES(?,'medium-17','active',?)").run(p.id,Date.now());db.prepare('UPDATE players SET xp=40 WHERE id=?').run(p.id);db.close();
 g=createGame(path);assert.equal(g.state(p.id).xp,40);assert.equal(g.state(p.id).active.xp,40);assert.equal(g.state(p.id).active.difficulty,'extreme');assert.equal(g.state(p.id).available.extreme,3);const a=g.state(p.id).active;assert.equal(g.finish(p.id,a.attemptId,'complete').xp,80);g.close();
 db=new DatabaseSync(path);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM quests').get().n,60);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM quests WHERE difficulty='medium'").get().n,15);db.close();
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('Reset requires a matching one-use confirmation and affects only the selected player',()=>{
 const g=createGame(':memory:');try{const a=g.identify(),b=g.identify();g.nickname(a.id,'Da resettare');g.nickname(b.id,'Altro player');let q=g.draw(a.id,'easy').active;g.finish(a.id,q.attemptId,'complete',{id:'reset-photo',title:'Ricordo'});const active=g.draw(a.id,'hard').active;const other=g.draw(b.id,'medium').active;
 const t=g.prepareReset(a.id,'owner-session');assert.equal(t.xp,30);assert.equal(g.state(a.id).xp,30);assert.throws(()=>g.resetProgress(a.id,t.confirmationToken,'Sbagliato','owner-session'));assert.throws(()=>g.resetProgress(a.id,t.confirmationToken,'Da resettare','other-session'));assert.throws(()=>g.resetProgress(b.id,t.confirmationToken,'Altro player','owner-session'));
 g.resetProgress(a.id,t.confirmationToken,'Da resettare','owner-session');const s=g.state(a.id);assert.equal(s.xp,0);assert.equal(s.level,1);assert.equal(s.active,null);assert.equal(s.history.length,0);assert.equal(s.nickname,'Da resettare');assert.equal(g.identify(a.token).id,a.id);assert.equal(s.available.easy,30);assert.equal(g.state(b.id).active.attemptId,other.attemptId);assert.equal(g.state(b.id).available.hard,10);assert.ok(active);const fresh=g.draw(a.id,'hard').active;assert.ok(fresh.attemptId>active.attemptId);assert.throws(()=>g.finish(a.id,active.attemptId,'complete'));assert.equal(g.state(a.id).active.attemptId,fresh.attemptId);assert.throws(()=>g.resetProgress(a.id,t.confirmationToken,'Da resettare','owner-session'));
 }finally{g.close();}
});
test('A reset confirmation becomes stale when the guest makes progress or changes nickname',()=>{
 const g=createGame(':memory:');try{const a=g.identify();g.nickname(a.id,'Prima');let t=g.prepareReset(a.id,'owner');g.nickname(a.id,'Dopo');assert.throws(()=>g.resetProgress(a.id,t.confirmationToken,'Dopo','owner'));t=g.prepareReset(a.id,'owner');g.draw(a.id,'easy');assert.throws(()=>g.resetProgress(a.id,t.confirmationToken,'Dopo','owner'));assert.ok(g.state(a.id).active);}finally{g.close();}
});
