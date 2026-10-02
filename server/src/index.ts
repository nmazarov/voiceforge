import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import {AccessToken} from 'livekit-server-sdk';
import {z} from 'zod';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {promisify} from 'node:util';

const scryptAsync=promisify(crypto.scrypt);
const PORT=Number(process.env.APP_PORT||3001);
const JWT_SECRET=process.env.JWT_SECRET||'change-me';
const LIVEKIT_API_KEY=process.env.LIVEKIT_API_KEY||'devkey';
const LIVEKIT_API_SECRET=process.env.LIVEKIT_API_SECRET||'secret';
const LIVEKIT_PUBLIC_URL=process.env.PUBLIC_LIVEKIT_URL||process.env.LIVEKIT_PUBLIC_URL||'ws://localhost:7880';
const DATA_DIR=process.env.DATA_DIR||'/app/data';
const BOOTSTRAP_ADMIN_USER=process.env.BOOTSTRAP_ADMIN_USER||'';
const BOOTSTRAP_ADMIN_PASSWORD=process.env.BOOTSTRAP_ADMIN_PASSWORD||'';
const ADMIN_KEY_HASH=process.env.ADMIN_KEY_HASH||'';

fs.mkdirSync(DATA_DIR,{recursive:true});
const db=new Database(path.join(DATA_DIR,'voiceforge.db'));
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT UNIQUE NOT NULL,password TEXT NOT NULL,is_admin INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS channels(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,type TEXT NOT NULL CHECK(type IN ('text','voice')));
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT,channel_id INTEGER NOT NULL,user_id INTEGER NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS audit_log(id INTEGER PRIMARY KEY AUTOINCREMENT,actor_user_id INTEGER,action TEXT NOT NULL,target_type TEXT,target_id TEXT,details TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
const cols=db.prepare('PRAGMA table_info(users)').all() as any[];
if(!cols.some(c=>c.name==='role'))db.exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'`);
if(!cols.some(c=>c.name==='disabled'))db.exec(`ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0`);
if(!cols.some(c=>c.name==='created_at'))db.exec(`ALTER TABLE users ADD COLUMN created_at TEXT`);
if(!cols.some(c=>c.name==='avatar'))db.exec(`ALTER TABLE users ADD COLUMN avatar TEXT`);
if(!cols.some(c=>c.name==='custom_status'))db.exec(`ALTER TABLE users ADD COLUMN custom_status TEXT`);
if(!cols.some(c=>c.name==='presence'))db.exec(`ALTER TABLE users ADD COLUMN presence TEXT NOT NULL DEFAULT 'offline'`);
const msgCols=db.prepare('PRAGMA table_info(messages)').all() as any[];
if(!msgCols.some(c=>c.name==='edited_at'))db.exec(`ALTER TABLE messages ADD COLUMN edited_at TEXT`);
if(!msgCols.some(c=>c.name==='reply_to_id'))db.exec(`ALTER TABLE messages ADD COLUMN reply_to_id INTEGER`);
if(!msgCols.some(c=>c.name==='attachment_url'))db.exec(`ALTER TABLE messages ADD COLUMN attachment_url TEXT`);
if(!msgCols.some(c=>c.name==='attachment_name'))db.exec(`ALTER TABLE messages ADD COLUMN attachment_name TEXT`);
db.exec(`CREATE TABLE IF NOT EXISTS reactions(id INTEGER PRIMARY KEY AUTOINCREMENT,message_id INTEGER NOT NULL,user_id INTEGER NOT NULL,username TEXT NOT NULL,emoji TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(message_id,user_id,emoji));
CREATE INDEX IF NOT EXISTS idx_reactions_msg ON reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_messages_chan ON messages(channel_id,id);`);
db.exec(`UPDATE users SET role='admin' WHERE is_admin=1 AND role='user'`);
if(!db.prepare('SELECT 1 FROM channels LIMIT 1').get()){const q=db.prepare('INSERT INTO channels(name,type) VALUES (?,?)');q.run('general','text');q.run('General','voice');q.run('Gaming','voice')}

type Role='user'|'admin'|'owner';
type User={id:number;username:string;role:Role;disabled:number};
async function hashPassword(value:string){const salt=crypto.randomBytes(16).toString('hex');const out=await scryptAsync(value,salt,64) as Buffer;return `scrypt$${salt}$${out.toString('hex')}`}
async function verifyPassword(value:string,stored:string){if(!stored.startsWith('scrypt$'))return stored===Buffer.from(`${value}:${JWT_SECRET}`).toString('base64url');const [,salt,hex]=stored.split('$');const expected=Buffer.from(hex,'hex');const actual=await scryptAsync(value,salt,expected.length) as Buffer;return expected.length===actual.length&&crypto.timingSafeEqual(expected,actual)}
const sha256=(v:string)=>crypto.createHash('sha256').update(v).digest('hex');
function safeHex(a:string,b:string){try{const x=Buffer.from(a,'hex'),y=Buffer.from(b,'hex');return x.length>0&&x.length===y.length&&crypto.timingSafeEqual(x,y)}catch{return false}}
const sign=(u:User,remember=true)=>jwt.sign(u,JWT_SECRET,{expiresIn:remember?'365d':'30d'});
function auth(req:any):User|null{const raw=req.headers.authorization?.replace(/^Bearer\s+/,'');if(!raw)return null;try{return jwt.verify(raw,JWT_SECRET) as User}catch{return null}}
function requireRole(req:any,reply:any,roles:Role[]){const u=auth(req);if(!u){reply.code(401).send({error:'Unauthorized'});return null}const row=db.prepare('SELECT role,disabled FROM users WHERE id=?').get(u.id) as any;if(!row||row.disabled){reply.code(403).send({error:'Account disabled'});return null}if(!roles.includes(row.role)){reply.code(403).send({error:'Insufficient permissions'});return null}return {...u,role:row.role,disabled:row.disabled} as User}
function audit(actor:number|null,action:string,targetType?:string,targetId?:string,details?:unknown){db.prepare('INSERT INTO audit_log(actor_user_id,action,target_type,target_id,details) VALUES (?,?,?,?,?)').run(actor,action,targetType||null,targetId||null,details?JSON.stringify(details):null)}
async function bootstrapOwner(){if(!BOOTSTRAP_ADMIN_USER||!BOOTSTRAP_ADMIN_PASSWORD)return;const owner=db.prepare(`SELECT id FROM users WHERE role='owner' LIMIT 1`).get();if(owner)return;const existing=db.prepare('SELECT id FROM users WHERE username=?').get(BOOTSTRAP_ADMIN_USER) as any;const encoded=await hashPassword(BOOTSTRAP_ADMIN_PASSWORD);if(existing){db.prepare(`UPDATE users SET password=?,role='owner',disabled=0 WHERE id=?`).run(encoded,existing.id);audit(existing.id,'bootstrap_owner','user',String(existing.id))}else{const info=db.prepare(`INSERT INTO users(username,password,role,created_at) VALUES (?,?,'owner',CURRENT_TIMESTAMP)`).run(BOOTSTRAP_ADMIN_USER,encoded);audit(Number(info.lastInsertRowid),'bootstrap_owner','user',String(info.lastInsertRowid))}}
await bootstrapOwner();

const ADMIN_HTML=`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VoiceForge Admin</title><style>:root{color-scheme:dark;--b:#090b12;--p:#111522;--l:#273049;--t:#eef1ff;--m:#8d96ad;--v:#7c3aed}*{box-sizing:border-box}body{margin:0;font:14px system-ui;background:radial-gradient(circle at 70% 0,#25154d55,transparent 35%),var(--b);color:var(--t)}button,input,select{font:inherit}.w{max-width:1180px;margin:auto;padding:28px}.brand{font-size:20px;font-weight:900;margin-bottom:22px}.brand span{color:#8b5cf6}.card{background:#111522e8;border:1px solid var(--l);border-radius:16px;padding:18px}.login{max-width:460px;margin:8vh auto}.tabs,.nav,.row{display:flex;gap:8px}.tabs button,.nav button,.mini{border:1px solid var(--l);background:#171c2b;color:#bac3d8;padding:9px 12px;border-radius:9px;cursor:pointer}.on{background:#2d2255!important;color:#fff!important}.field{width:100%;padding:12px;background:#0c101a;border:1px solid #303950;border-radius:10px;color:white}label{display:block;color:var(--m);font-size:10px;font-weight:800;margin:15px 0 7px}.primary{width:100%;margin-top:14px;padding:12px;border:0;border-radius:10px;color:white;font-weight:800;background:linear-gradient(100deg,var(--v),#3284ff)}.hidden{display:none}.top{display:flex;justify-content:space-between;align-items:center}.nav{margin:18px 0;flex-wrap:wrap}.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px}.stat strong{display:block;font-size:28px}.muted{color:var(--m)}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px;border-bottom:1px solid #222a40}th{font-size:10px;color:var(--m)}.badge{font-size:10px;padding:4px 7px;border-radius:999px;background:#292140}.danger{color:#ff9aa5!important}.row .field{flex:1}@media(max-width:850px){.grid{grid-template-columns:1fr 1fr}}</style></head><body><div class="w"><div class="brand">VOICE<span>FORGE</span> ADMIN</div><section id="login" class="card login"><div class="tabs"><button id="tp" class="on">Логин + пароль</button><button id="tk">Admin Key</button></div><div id="pb"><label>ЛОГИН</label><input id="u" class="field" value="owner"><label>ПАРОЛЬ</label><input id="p" class="field" type="password"><button id="lp" class="primary">Войти</button></div><div id="kb" class="hidden"><label>ADMIN KEY</label><input id="k" class="field" type="password" placeholder="VF-OWNER-..."><button id="lk" class="primary">Войти по ключу</button><p class="muted">Ключ не сохраняется в браузере.</p></div><p id="err" class="danger"></p></section><section id="app" class="hidden"><div class="top"><div><b id="who"></b><div id="role" class="muted"></div></div><button id="logout" class="mini">Выйти</button></div><div class="nav"><button data-page="overview" class="on">Dashboard</button><button data-page="users">Пользователи</button><button data-page="channels">Каналы</button><button data-page="audit">Audit log</button></div><div id="overview" class="page"><div id="stats" class="grid"></div></div><div id="users" class="page hidden"><div class="card"><h3>Пользователи</h3><div id="ut"></div></div></div><div id="channels" class="page hidden"><div class="card"><h3>Каналы</h3><div class="row"><input id="cn" class="field" placeholder="Название"><select id="ct" class="field"><option value="text">Text</option><option value="voice">Voice</option></select><button id="ac" class="mini">Создать</button></div><div id="cht"></div></div></div><div id="audit" class="page hidden"><div class="card"><h3>Audit log</h3><div id="at"></div></div></div></section></div><script>let token='',me=null;const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));async function api(url,opt={}){opt.headers={...(opt.headers||{}),...(token?{Authorization:'Bearer '+token}:{})};if(opt.body)opt.headers['Content-Type']='application/json';const r=await fetch(url,opt),j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||r.statusText);return j}function tabs(key){$('#pb').classList.toggle('hidden',key);$('#kb').classList.toggle('hidden',!key);$('#tp').classList.toggle('on',!key);$('#tk').classList.toggle('on',key)}$('#tp').onclick=()=>tabs(false);$('#tk').onclick=()=>tabs(true);async function done(j){token=j.token;me=j.user;$('#login').classList.add('hidden');$('#app').classList.remove('hidden');$('#who').textContent=me.username;$('#role').textContent=me.role.toUpperCase();await load()}$('#lp').onclick=async()=>{try{done(await api('/api/auth/login',{method:'POST',body:JSON.stringify({username:$('#u').value,password:$('#p').value})}))}catch(e){$('#err').textContent=e.message}};$('#lk').onclick=async()=>{try{done(await api('/api/admin/key-login',{method:'POST',body:JSON.stringify({key:$('#k').value})}))}catch(e){$('#err').textContent=e.message}};$('#logout').onclick=()=>location.reload();document.querySelectorAll('.nav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('.nav button').forEach(x=>x.classList.remove('on'));b.classList.add('on');document.querySelectorAll('.page').forEach(x=>x.classList.add('hidden'));$('#'+b.dataset.page).classList.remove('hidden')});async function load(){await Promise.all([ov(),users(),channels(),audit()])}async function ov(){const x=await api('/api/admin/overview');$('#stats').innerHTML=Object.entries(x).map(([k,v])=>'<div class="card stat"><span class="muted">'+esc(k)+'</span><strong>'+esc(v)+'</strong></div>').join('')}async function users(){const x=await api('/api/admin/users');$('#ut').innerHTML='<table><tr><th>ID</th><th>USER</th><th>ROLE</th><th>STATUS</th><th>ACTIONS</th></tr>'+x.map(u=>'<tr><td>'+u.id+'</td><td>'+esc(u.username)+'</td><td><span class="badge">'+esc(u.role)+'</span></td><td>'+(u.disabled?'blocked':'active')+'</td><td>'+(u.role==='owner'?'—':'<button class="mini" onclick="tog('+u.id+','+(!u.disabled)+')">'+(u.disabled?'Unblock':'Block')+'</button> '+(me.role==='owner'?'<button class="mini" onclick="rol('+u.id+','+JSON.stringify(u.role==='admin'?'user':'admin')+')">'+(u.role==='admin'?'Demote':'Promote')+'</button>':''))+'</td></tr>').join('')+'</table>'}async function tog(id,disabled){await api('/api/admin/users/'+id,{method:'PATCH',body:JSON.stringify({disabled})});users();ov()}async function rol(id,role){await api('/api/admin/users/'+id,{method:'PATCH',body:JSON.stringify({role})});users();ov()}async function channels(){const x=await api('/api/channels');$('#cht').innerHTML='<table><tr><th>ID</th><th>NAME</th><th>TYPE</th><th></th></tr>'+x.map(c=>'<tr><td>'+c.id+'</td><td>'+esc(c.name)+'</td><td>'+esc(c.type)+'</td><td><button class="mini danger" onclick="delc('+c.id+')">Delete</button></td></tr>').join('')+'</table>'}$('#ac').onclick=async()=>{await api('/api/admin/channels',{method:'POST',body:JSON.stringify({name:$('#cn').value,type:$('#ct').value})});$('#cn').value='';channels();ov()};async function delc(id){if(confirm('Удалить канал?')){await api('/api/admin/channels/'+id,{method:'DELETE'});channels();ov()}}async function audit(){try{const x=await api('/api/admin/audit');$('#at').innerHTML='<table><tr><th>TIME</th><th>ACTOR</th><th>ACTION</th><th>TARGET</th></tr>'+x.map(a=>'<tr><td>'+esc(a.created_at)+'</td><td>'+esc(a.actor_username||'system')+'</td><td>'+esc(a.action)+'</td><td>'+esc((a.target_type||'')+' '+(a.target_id||''))+'</td></tr>').join('')+'</table>'}catch{$('#at').innerHTML='<p class="muted">Audit log доступен владельцу.</p>'}}</script></body></html>`;

const app=Fastify({logger:true});
await app.register(cors,{origin:true});
await app.register(websocket);
app.get('/admin',async(_req,reply)=>reply.type('text/html; charset=utf-8').send(ADMIN_HTML));
app.get('/api/health',async()=>({ok:true,name:'VoiceForge',version:'1.1.0',mode:'server',admin:'/admin'}));
app.post('/api/auth/register',async(req,reply)=>{const b=z.object({username:z.string().min(2).max(32).regex(/^[a-zA-Z0-9_.-]+$/),password:z.string().min(8).max(128),remember:z.boolean().optional().default(true)}).parse(req.body);if(db.prepare('SELECT id FROM users WHERE username=?').get(b.username))return reply.code(409).send({error:'Username already exists'});const info=db.prepare(`INSERT INTO users(username,password,role,created_at) VALUES (?,?,'user',CURRENT_TIMESTAMP)`).run(b.username,await hashPassword(b.password));const user={id:Number(info.lastInsertRowid),username:b.username,role:'user' as Role,disabled:0};audit(user.id,'register','user',String(user.id));return{token:sign(user,b.remember),user}});
app.post('/api/auth/login',async(req,reply)=>{const b=z.object({username:z.string(),password:z.string(),remember:z.boolean().optional().default(true)}).parse(req.body);const row=db.prepare('SELECT id,username,password,role,disabled FROM users WHERE username=?').get(b.username) as any;if(!row||row.disabled||!(await verifyPassword(b.password,row.password)))return reply.code(401).send({error:'Invalid credentials'});if(!row.password.startsWith('scrypt$'))db.prepare('UPDATE users SET password=? WHERE id=?').run(await hashPassword(b.password),row.id);const user={id:row.id,username:row.username,role:row.role as Role,disabled:row.disabled};audit(user.id,'login',undefined,undefined,{remember:b.remember});return{token:sign(user,b.remember),user}});
app.get('/api/auth/session',async(req,reply)=>{const user=auth(req);if(!user)return reply.code(401).send({error:'Session expired'});const row=db.prepare('SELECT id,username,role,disabled FROM users WHERE id=?').get(user.id) as any;if(!row||row.disabled)return reply.code(403).send({error:'Account disabled'});return{user:row}});
app.post('/api/admin/key-login',async(req,reply)=>{const {key}=z.object({key:z.string().min(32).max(256)}).parse(req.body);if(!ADMIN_KEY_HASH||!safeHex(sha256(key),ADMIN_KEY_HASH))return reply.code(401).send({error:'Invalid admin key'});const owner=db.prepare(`SELECT id,username,role,disabled FROM users WHERE role='owner' AND disabled=0 ORDER BY id LIMIT 1`).get() as any;if(!owner)return reply.code(503).send({error:'Owner account is not initialized'});audit(owner.id,'admin_key_login');return{token:sign(owner),user:owner}});
app.get('/api/admin/overview',async(req,reply)=>{const u=requireRole(req,reply,['admin','owner']);if(!u)return;return{users:(db.prepare('SELECT COUNT(*) c FROM users').get() as any).c,admins:(db.prepare(`SELECT COUNT(*) c FROM users WHERE role IN ('admin','owner')`).get() as any).c,blocked:(db.prepare('SELECT COUNT(*) c FROM users WHERE disabled=1').get() as any).c,channels:(db.prepare('SELECT COUNT(*) c FROM channels').get() as any).c,messages:(db.prepare('SELECT COUNT(*) c FROM messages').get() as any).c}});
app.get('/api/admin/users',async(req,reply)=>{const u=requireRole(req,reply,['admin','owner']);if(!u)return;return db.prepare(`SELECT id,username,role,disabled,created_at FROM users ORDER BY id`).all()});
app.patch('/api/admin/users/:id',async(req:any,reply)=>{const actor=requireRole(req,reply,['admin','owner']);if(!actor)return;const id=Number(req.params.id);const body=z.object({role:z.enum(['user','admin']).optional(),disabled:z.boolean().optional()}).parse(req.body);const target=db.prepare('SELECT role FROM users WHERE id=?').get(id) as any;if(!target)return reply.code(404).send({error:'User not found'});if(target.role==='owner')return reply.code(403).send({error:'Owner cannot be modified'});if(body.role!==undefined&&actor.role!=='owner')return reply.code(403).send({error:'Only owner can change roles'});if(body.role!==undefined)db.prepare('UPDATE users SET role=? WHERE id=?').run(body.role,id);if(body.disabled!==undefined)db.prepare('UPDATE users SET disabled=? WHERE id=?').run(body.disabled?1:0,id);audit(actor.id,'update_user','user',String(id),body);return{ok:true}});
app.post('/api/admin/channels',async(req,reply)=>{const actor=requireRole(req,reply,['admin','owner']);if(!actor)return;const b=z.object({name:z.string().min(1).max(64),type:z.enum(['text','voice'])}).parse(req.body);const info=db.prepare('INSERT INTO channels(name,type) VALUES (?,?)').run(b.name,b.type);audit(actor.id,'create_channel','channel',String(info.lastInsertRowid),b);return{id:Number(info.lastInsertRowid),...b}});
app.delete('/api/admin/channels/:id',async(req:any,reply)=>{const actor=requireRole(req,reply,['admin','owner']);if(!actor)return;const id=Number(req.params.id);db.prepare('DELETE FROM channels WHERE id=?').run(id);audit(actor.id,'delete_channel','channel',String(id));return{ok:true}});
app.get('/api/admin/audit',async(req,reply)=>{const actor=requireRole(req,reply,['owner']);if(!actor)return;return db.prepare(`SELECT a.*,u.username actor_username FROM audit_log a LEFT JOIN users u ON u.id=a.actor_user_id ORDER BY a.id DESC LIMIT 250`).all()});
const wsClients = new Set<any>();
function broadcast(event: string, payload: any) {
  const data = JSON.stringify({ event, payload });
  for (const client of wsClients) {
    try {
      if (client.readyState === 1) client.send(data);
    } catch {}
  }
}
app.get('/api/ws', { websocket: true }, (connection, req) => {
  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token') || req.headers.authorization?.replace(/^Bearer\s+/, '');
  let user: User | null = null;
  if (token) {
    try { user = jwt.verify(token, JWT_SECRET) as User; } catch {}
  }
  if (!user) {
    connection.socket.close(4001, 'Unauthorized');
    return;
  }
  wsClients.add(connection.socket);
  connection.socket.send(JSON.stringify({ event: 'connected', user: { id: user.id, username: user.username } }));
  connection.socket.on('message', (raw: any) => {
    try {
      const data = JSON.parse(raw.toString());
      if (data.event === 'reaction') {
        broadcast('message:reaction', {
          channelId: data.channelId,
          messageId: data.messageId,
          emoji: data.emoji,
          username: user!.username,
        });
      }
    } catch {}
  });
  connection.socket.on('close', () => {
    wsClients.delete(connection.socket);
  });
});
app.get('/api/channels',async()=>db.prepare('SELECT id,name,type FROM channels ORDER BY type,id').all());
app.get('/api/channels/:id/messages',async(req:any,reply)=>{
  const u=auth(req);
  if(!u)return reply.code(401).send({error:'Unauthorized'});
  const raw=db.prepare(`
    SELECT m.id,m.body,m.created_at,m.reply_to_id,m.attachment_url,u.username,
           r.username as reply_user,r.body as reply_body
    FROM messages m
    JOIN users u ON u.id=m.user_id
    LEFT JOIN messages r ON r.id=m.reply_to_id
    WHERE m.channel_id=?
    ORDER BY m.id DESC LIMIT 100
  `).all(req.params.id).reverse() as any[];
  return raw.map(m=>({
    id:m.id,
    body:m.body,
    created_at:m.created_at,
    username:m.username,
    attachment:m.attachment_url,
    reply_to:m.reply_to_id?{id:m.reply_to_id,username:m.reply_user||'user',body:m.reply_body||''}:null,
    reactions:{}
  }));
});
app.post('/api/channels/:id/messages',async(req:any,reply)=>{
  const u=auth(req);
  if(!u)return reply.code(401).send({error:'Unauthorized'});
  const row=db.prepare('SELECT disabled FROM users WHERE id=?').get(u.id) as any;
  if(!row||row.disabled)return reply.code(403).send({error:'Account disabled'});
  const {body,reply_to,attachment}=z.object({
    body:z.string().min(1).max(5000),
    reply_to:z.object({id:z.number(),username:z.string(),body:z.string()}).nullable().optional(),
    attachment:z.string().nullable().optional()
  }).parse(req.body);
  const info=db.prepare('INSERT INTO messages(channel_id,user_id,body,reply_to_id,attachment_url) VALUES (?,?,?,?,?)').run(
    req.params.id,
    u.id,
    body,
    reply_to?reply_to.id:null,
    attachment||null
  );
  const msg={
    id:Number(info.lastInsertRowid),
    channel_id:Number(req.params.id),
    user_id:u.id,
    username:u.username,
    body,
    reply_to:reply_to||null,
    attachment:attachment||null,
    reactions:{},
    created_at:new Date().toISOString()
  };
  broadcast('message:created',msg);
  return msg;
});
app.post('/api/livekit/token',async(req:any,reply)=>{const u=auth(req);if(!u)return reply.code(401).send({error:'Unauthorized'});const row=db.prepare('SELECT disabled FROM users WHERE id=?').get(u.id) as any;if(!row||row.disabled)return reply.code(403).send({error:'Account disabled'});const {room}=z.object({room:z.string().min(1).max(64)}).parse(req.body);const t=new AccessToken(LIVEKIT_API_KEY,LIVEKIT_API_SECRET,{identity:String(u.id),name:u.username});t.addGrant({roomJoin:true,room,canPublish:true,canSubscribe:true,canPublishData:true});return{token:await t.toJwt(),url:LIVEKIT_PUBLIC_URL}});
await app.listen({port:PORT,host:'0.0.0.0'});
