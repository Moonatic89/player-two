import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash, randomInt } from 'node:crypto';
import { quests } from './quests.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=(message,status=409)=>{throw Object.assign(Error(message),{status});};
export function createGame(filename){
 const db=new DatabaseSync(filename);db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS players(id INTEGER PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, nickname TEXT NOT NULL DEFAULT '', xp INTEGER NOT NULL DEFAULT 0 CHECK(xp>=0), created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS quests(id TEXT PRIMARY KEY, difficulty TEXT NOT NULL, xp INTEGER NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS attempts(id INTEGER PRIMARY KEY,player_id INTEGER NOT NULL REFERENCES players(id),quest_id TEXT NOT NULL REFERENCES quests(id),status TEXT NOT NULL CHECK(status IN ('active','completed','abandoned','expired')),started_at INTEGER NOT NULL,finished_at INTEGER,xp_delta INTEGER);
 CREATE UNIQUE INDEX IF NOT EXISTS one_active_player ON attempts(player_id) WHERE status='active';
 CREATE UNIQUE INDEX IF NOT EXISTS one_active_quest ON attempts(quest_id) WHERE status='active';
 CREATE TABLE IF NOT EXISTS accesses(id INTEGER PRIMARY KEY,player_id INTEGER NOT NULL REFERENCES players(id),at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS player_history ON attempts(player_id,quest_id,status);`);
 // Snapshot rewards before recategorizing existing quests. Apply migration atomically.
 db.exec('BEGIN IMMEDIATE');
 try {
 const columns=new Set(db.prepare('PRAGMA table_info(attempts)').all().map(c=>c.name));
 for(const [name,type]of [['reward_xp','INTEGER'],['photo_id','TEXT'],['photo_title','TEXT'],['photo_bonus','INTEGER NOT NULL DEFAULT 0']])if(!columns.has(name))db.exec(`ALTER TABLE attempts ADD COLUMN ${name} ${type}`);
 db.exec('UPDATE attempts SET reward_xp=(SELECT xp FROM quests WHERE quests.id=attempts.quest_id) WHERE reward_xp IS NULL');
 db.exec("CREATE UNIQUE INDEX IF NOT EXISTS one_photo_bonus_per_player ON attempts(player_id,photo_id) WHERE photo_id IS NOT NULL");
 const seed=db.prepare('INSERT INTO quests(id,difficulty,xp,title,description) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET difficulty=excluded.difficulty,xp=excluded.xp,title=excluded.title,description=excluded.description');
 for(const q of quests)seed.run(q.id,q.difficulty,q.xp,q.title,q.description);
 db.exec('COMMIT');
 } catch(e){db.exec('ROLLBACK');db.close();throw e;}

 function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
 function expire(){db.prepare("UPDATE attempts SET status='expired',finished_at=?,xp_delta=0 WHERE status='active' AND started_at<?").run(Date.now(),Date.now()-6*3600000);}
 function identify(token,log=false){let p=/^[a-f0-9]{64}$/.test(token||'')?db.prepare('SELECT * FROM players WHERE token_hash=?').get(hash(token)):null;let fresh;
 if(!p){fresh=randomBytes(32).toString('hex');const now=Date.now();const r=db.prepare('INSERT INTO players(token_hash,created_at,last_seen) VALUES(?,?,?)').run(hash(fresh),now,now);p=db.prepare('SELECT * FROM players WHERE id=?').get(r.lastInsertRowid);log=true;}
 if(log){const last=db.prepare('SELECT MAX(at) AS at FROM accesses WHERE player_id=?').get(p.id).at;if(!last||Date.now()-last>30*60000)db.prepare('INSERT INTO accesses(player_id,at) VALUES(?,?)').run(p.id,Date.now());db.prepare('UPDATE players SET last_seen=? WHERE id=?').run(Date.now(),p.id);}
 return {id:p.id,token:fresh};}
 function available(id,difficulty){return db.prepare(`SELECT q.* FROM quests q WHERE q.difficulty=? AND NOT EXISTS(SELECT 1 FROM attempts a WHERE a.quest_id=q.id AND a.status='active') AND NOT EXISTS(SELECT 1 FROM attempts a WHERE a.quest_id=q.id AND a.player_id=? AND a.status IN ('completed','abandoned'))`).all(difficulty,id);}
 function state(id){expire();const p=db.prepare('SELECT nickname,xp FROM players WHERE id=?').get(id);const active=db.prepare("SELECT a.id AS attemptId,a.started_at AS startedAt,q.*,COALESCE(a.reward_xp,q.xp) AS xp FROM attempts a JOIN quests q ON q.id=a.quest_id WHERE a.player_id=? AND a.status='active'").get(id)||null;
 return {...p,level:1+Math.floor(p.xp/100),active:active?{...active,expiresAt:active.startedAt+6*3600000}:null,available:Object.fromEntries(['easy','medium','hard','extreme'].map(d=>[d,available(id,d).length])),history:db.prepare("SELECT a.id,a.status,a.xp_delta AS xpDelta,a.finished_at AS finishedAt,a.photo_id AS photoId,a.photo_title AS photoTitle,a.photo_bonus AS photoBonus,q.title,q.difficulty FROM attempts a JOIN quests q ON q.id=a.quest_id WHERE a.player_id=? AND a.status!='active' ORDER BY a.id DESC LIMIT 30").all(id)};}
 function nickname(id,name){if(typeof name!=='string')fail('Inserisci un nickname.',400);name=name.trim().normalize('NFC');if([...name].length<2||[...name].length>24||/[\p{C}]/u.test(name))fail('Il nickname deve avere da 2 a 24 caratteri, senza caratteri di controllo.',400);db.prepare('UPDATE players SET nickname=? WHERE id=?').run(name,id);return state(id);}
 function draw(id,difficulty){return transaction(()=>{expire();if(!['easy','medium','hard','extreme'].includes(difficulty))fail('Scegli una difficoltà valida.',400);if(!db.prepare('SELECT nickname FROM players WHERE id=?').get(id).nickname)fail('Scegli prima il tuo nickname.',400);if(db.prepare("SELECT id FROM attempts WHERE player_id=? AND status='active'").get(id))fail('Hai già una quest attiva.');const choices=available(id,difficulty);if(!choices.length)fail('Nessuna quest disponibile in questa categoria. Prova un’altra difficoltà.');const q=choices[randomInt(choices.length)];db.prepare("INSERT INTO attempts(player_id,quest_id,status,started_at,reward_xp) VALUES(?,?,'active',?,?)").run(id,q.id,Date.now(),q.xp);return state(id);});}
 function finish(id,attemptId,action,photo=null){return transaction(()=>{expire();if(!Number.isSafeInteger(attemptId)||!['complete','abandon'].includes(action))fail('Richiesta non valida.',400);
 const a=db.prepare("SELECT a.*,COALESCE(a.reward_xp,q.xp) AS xp FROM attempts a JOIN quests q ON q.id=a.quest_id WHERE a.id=? AND a.player_id=? AND a.status='active'").get(attemptId,id);if(!a)fail('Questa quest non è più attiva. Aggiorna il profilo.');
 if(photo&&(action!=='complete'||typeof photo.id!=='string'||!/^[a-zA-Z0-9_-]{1,200}$/.test(photo.id)||typeof photo.title!=='string'||[...photo.title].length>120||/[\p{C}]/u.test(photo.title)))fail('Foto o titolo non valido.',400);
 if(photo&&db.prepare('SELECT id FROM attempts WHERE player_id=? AND photo_id=?').get(id,photo.id))fail('Hai già usato questa foto per una quest. Scegline un’altra o conferma senza foto.');
 const p=db.prepare('SELECT xp FROM players WHERE id=?').get(id),bonus=photo?Math.round(a.xp/2):0;
 const delta=action==='complete'?a.xp+bonus:-Math.min(p.xp,a.xp/4);
 db.prepare('UPDATE players SET xp=xp+? WHERE id=?').run(delta,id);
 db.prepare('UPDATE attempts SET status=?,finished_at=?,xp_delta=?,photo_id=?,photo_title=?,photo_bonus=? WHERE id=?').run(action==='complete'?'completed':'abandoned',Date.now(),delta,photo?.id||null,photo?.title||null,bonus,a.id);return state(id);});}
 function photoTitles(ids){const query=db.prepare("SELECT a.photo_title AS photoTitle,q.title AS questTitle FROM attempts a JOIN quests q ON q.id=a.quest_id WHERE a.photo_id=? AND a.status='completed' ORDER BY a.id DESC LIMIT 1");return Object.fromEntries(ids.map(id=>[id,query.get(id)||{}]));}
 function overview(){expire();return {
 totals:db.prepare(`SELECT (SELECT COUNT(*) FROM players) AS visitors,(SELECT COUNT(*) FROM players WHERE nickname!='') AS players,(SELECT COUNT(*) FROM attempts WHERE status='active') AS active,(SELECT COUNT(*) FROM attempts WHERE status='completed') AS completed,(SELECT COUNT(*) FROM attempts WHERE status='abandoned') AS abandoned`).get(),
 players:db.prepare(`SELECT p.id,p.nickname,p.xp,p.last_seen AS lastSeen,
 (SELECT COUNT(*) FROM accesses WHERE player_id=p.id) AS accesses,
 (SELECT COUNT(*) FROM attempts WHERE player_id=p.id AND status='completed') AS completed,
 (SELECT COUNT(*) FROM attempts WHERE player_id=p.id AND status='abandoned') AS abandoned,
 (SELECT q.title FROM attempts a JOIN quests q ON q.id=a.quest_id WHERE a.player_id=p.id AND a.status='active') AS activeTitle
 FROM players p WHERE p.nickname!='' ORDER BY p.xp DESC,p.last_seen DESC,p.id`).all()};}
 function details(id,before=Number.MAX_SAFE_INTEGER){expire();const player=db.prepare('SELECT id,nickname,xp,created_at AS createdAt,last_seen AS lastSeen FROM players WHERE id=?').get(id);if(!player)fail('Invitato non trovato.',404);const attempts=db.prepare(`SELECT a.id,a.status,a.started_at AS startedAt,a.finished_at AS finishedAt,a.xp_delta AS xpDelta,q.title,q.description,q.difficulty,COALESCE(a.reward_xp,q.xp) AS xp,a.photo_id AS photoId,a.photo_title AS photoTitle,a.photo_bonus AS photoBonus FROM attempts a JOIN quests q ON q.id=a.quest_id WHERE a.player_id=? AND a.id<? ORDER BY a.id DESC LIMIT 51`).all(id,before);return {player,attempts:attempts.slice(0,50),nextBefore:attempts.length>50?attempts[49].id:null};}
 return {identify,state,nickname,draw,finish,photoTitles,overview,details,close:()=>db.close()};
}
