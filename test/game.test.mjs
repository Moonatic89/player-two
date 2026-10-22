import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGame} from '../game.mjs';
import {quests} from '../quests.mjs';

test('Catalog contains exactly 30 easy, 20 medium, 10 hard quests',()=>{
 for(const [d,n] of [['easy',30],['medium',20],['hard',10]])assert.equal(quests.filter(q=>q.difficulty===d).length,n);
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
 const {mkdtemp,rm}=await import('node:fs/promises');const dir=await mkdtemp('/tmp/player2-db-');try{let game=createGame(dir+'/game.sqlite');const p=game.identify();game.nickname(p.id,'Persistente');const q=game.draw(p.id,'medium').active;game.finish(p.id,q.attemptId,'abandon');game.close();game=createGame(dir+'/game.sqlite');assert.equal(game.identify(p.token).id,p.id);assert.equal(game.state(p.id).nickname,'Persistente');assert.equal(game.state(p.id).available.medium,19);game.close();}finally{await rm(dir,{recursive:true,force:true});}
});
