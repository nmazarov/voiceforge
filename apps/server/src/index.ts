import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import { AccessToken } from 'livekit-server-sdk';
import { z } from 'zod';
import path from 'node:path';
import fs from 'node:fs';

const PORT = Number(process.env.PORT || 3001);
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'devkey';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'secret';
const LIVEKIT_PUBLIC_URL = process.env.LIVEKIT_PUBLIC_URL || 'ws://localhost:7880';
const DATA_DIR = process.env.DATA_DIR || './data';
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'voiceforge.db'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS channels(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('text','voice')));
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT, channel_id INTEGER NOT NULL, user_id INTEGER NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
`);
if (!(db.prepare('SELECT 1 FROM channels LIMIT 1').get())) {
  const insert = db.prepare('INSERT INTO channels(name,type) VALUES (?,?)');
  insert.run('general','text'); insert.run('General','voice'); insert.run('Gaming','voice');
}

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
await app.register(websocket);

type User = { id:number; username:string; is_admin:number };
function sign(user: User) { return jwt.sign(user, JWT_SECRET, { expiresIn:'30d' }); }
function authHeader(req:any): User | null {
  const raw = req.headers.authorization?.replace(/^Bearer\s+/,'');
  if (!raw) return null;
  try { return jwt.verify(raw, JWT_SECRET) as User; } catch { return null; }
}
function hashPassword(input:string) {
  return Buffer.from(`${input}:${JWT_SECRET}`).toString('base64url');
}

app.get('/api/health', async () => ({ ok:true, name:'VoiceForge', version:'0.1.0' }));
app.post('/api/auth/register', async (req, reply) => {
  const body = z.object({username:z.string().min(2).max(32).regex(/^[a-zA-Z0-9_.-]+$/),password:z.string().min(4).max(128)}).parse(req.body);
  const exists = db.prepare('SELECT id FROM users WHERE username=?').get(body.username);
  if (exists) return reply.code(409).send({error:'Username already exists'});
  const count = (db.prepare('SELECT COUNT(*) c FROM users').get() as any).c as number;
  const info = db.prepare('INSERT INTO users(username,password,is_admin) VALUES (?,?,?)').run(body.username,hashPassword(body.password),count===0?1:0);
  const user = {id:Number(info.lastInsertRowid),username:body.username,is_admin:count===0?1:0};
  return {token:sign(user),user};
});
app.post('/api/auth/login', async (req, reply) => {
  const body = z.object({username:z.string(),password:z.string()}).parse(req.body);
  const row = db.prepare('SELECT id,username,is_admin,password FROM users WHERE username=?').get(body.username) as any;
  if (!row || row.password !== hashPassword(body.password)) return reply.code(401).send({error:'Invalid credentials'});
  const user={id:row.id,username:row.username,is_admin:row.is_admin}; return {token:sign(user),user};
});
app.get('/api/channels', async () => db.prepare('SELECT id,name,type FROM channels ORDER BY type,id').all());
app.get('/api/channels/:id/messages', async (req:any, reply) => {
  if (!authHeader(req)) return reply.code(401).send({error:'Unauthorized'});
  return db.prepare(`SELECT m.id,m.body,m.created_at,u.username FROM messages m JOIN users u ON u.id=m.user_id WHERE m.channel_id=? ORDER BY m.id DESC LIMIT 100`).all(req.params.id).reverse();
});
app.post('/api/channels/:id/messages', async (req:any, reply) => {
  const user=authHeader(req); if(!user) return reply.code(401).send({error:'Unauthorized'});
  const {body}=z.object({body:z.string().min(1).max(2000)}).parse(req.body);
  db.prepare('INSERT INTO messages(channel_id,user_id,body) VALUES (?,?,?)').run(req.params.id,user.id,body);
  return {ok:true};
});
app.post('/api/livekit/token', async (req:any, reply) => {
  const user=authHeader(req); if(!user) return reply.code(401).send({error:'Unauthorized'});
  const {room}=z.object({room:z.string().min(1).max(64)}).parse(req.body);
  const token = new AccessToken(LIVEKIT_API_KEY,LIVEKIT_API_SECRET,{identity:String(user.id),name:user.username});
  token.addGrant({roomJoin:true,room,canPublish:true,canSubscribe:true,canPublishData:true});
  return {token:await token.toJwt(),url:LIVEKIT_PUBLIC_URL};
});

const clientDir = path.resolve('apps/client/dist');
if (fs.existsSync(clientDir)) {
  await app.register(fastifyStatic,{root:clientDir,wildcard:false});
  app.setNotFoundHandler((req, reply) => req.url.startsWith('/api/') ? reply.code(404).send({error:'Not found'}) : reply.sendFile('index.html'));
}

await app.listen({port:PORT,host:'0.0.0.0'});
