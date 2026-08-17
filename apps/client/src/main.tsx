import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Room,RoomEvent,Track,RemoteTrack,RemoteParticipant} from 'livekit-client';
import './style.css';

type Channel={id:number;name:string;type:'text'|'voice'};
type Msg={id:number;body:string;created_at:string;username:string};
const desktop=Boolean((window as any).voiceforgeDesktop?.isDesktop);
const normalizeServer=(v:string)=>v.trim().replace(/\/$/,'');
const API=()=>desktop ? normalizeServer(localStorage.getItem('vf_server')||'') : ((import.meta as any).env.VITE_API_URL || '');

function App(){
 const [server,setServer]=useState(API());
 const [token,setToken]=useState(localStorage.getItem('vf_token')||'');
 const [username,setUsername]=useState(localStorage.getItem('vf_user')||'');
 const [channels,setChannels]=useState<Channel[]>([]); const [activeText,setActiveText]=useState<Channel|null>(null);
 const [messages,setMessages]=useState<Msg[]>([]); const [text,setText]=useState(''); const [voice,setVoice]=useState<string>('');
 const [participants,setParticipants]=useState<string[]>([]); const [room,setRoom]=useState<Room|null>(null); const mediaRef=useRef<HTMLDivElement>(null);
 const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};

 useEffect(()=>{if(!desktop||server)loadChannels()},[server]);
 useEffect(()=>{if(activeText&&token)loadMessages()},[activeText,token]);

 async function loadChannels(){
  try{const r=await fetch(`${API()}/api/channels`);if(!r.ok)throw new Error();const x:Channel[]=await r.json();setChannels(x);setActiveText(x.find(c=>c.type==='text')||null)}catch{if(desktop)setServer('')}
 }
 async function connectServer(address:string){
  const clean=normalizeServer(address.startsWith('http')?address:`http://${address}`);
  try{const r=await fetch(`${clean}/api/health`);const j=await r.json();if(!r.ok||!j.ok)throw new Error();localStorage.setItem('vf_server',clean);localStorage.removeItem('vf_token');localStorage.removeItem('vf_user');setToken('');setUsername('');setServer(clean)}catch{alert('Не удалось подключиться к VoiceForge серверу')}
 }
 function changeServer(){if(room)room.disconnect();localStorage.removeItem('vf_server');localStorage.removeItem('vf_token');localStorage.removeItem('vf_user');setServer('');setToken('');setChannels([]);setActiveText(null)}
 async function auth(mode:'login'|'register',u:string,p:string){const r=await fetch(`${API()}/api/auth/${mode}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});const j=await r.json();if(!r.ok)return alert(j.error||'Auth error');localStorage.setItem('vf_token',j.token);localStorage.setItem('vf_user',j.user.username);setToken(j.token);setUsername(j.user.username)}
 async function loadMessages(){const r=await fetch(`${API()}/api/channels/${activeText!.id}/messages`,{headers});if(r.ok)setMessages(await r.json())}
 async function send(){if(!text.trim()||!activeText)return;await fetch(`${API()}/api/channels/${activeText.id}/messages`,{method:'POST',headers,body:JSON.stringify({body:text})});setText('');await loadMessages()}
 async function joinVoice(name:string){
  if(room) await room.disconnect(); const r=await fetch(`${API()}/api/livekit/token`,{method:'POST',headers,body:JSON.stringify({room:`voice-${name}`})}); const j=await r.json(); if(!r.ok)return alert(j.error||'Voice error');
  const next=new Room({adaptiveStream:true,dynacast:true});
  const refresh=()=>setParticipants([next.localParticipant.name||username,...Array.from(next.remoteParticipants.values()).map(p=>p.name||p.identity)]);
  next.on(RoomEvent.ParticipantConnected,refresh);next.on(RoomEvent.ParticipantDisconnected,refresh);
  next.on(RoomEvent.TrackSubscribed,(track:RemoteTrack,_pub,participant:RemoteParticipant)=>{const el=track.attach(); if(track.kind===Track.Kind.Audio) document.body.appendChild(el); else mediaRef.current?.appendChild(el); refresh();});
  next.on(RoomEvent.TrackUnsubscribed,(track)=>track.detach().forEach(e=>e.remove()));
  await next.connect(j.url,j.token); await next.localParticipant.setMicrophoneEnabled(true); setRoom(next); setVoice(name); refresh();
 }
 async function toggleMute(){if(!room)return;await room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled);setRoom(room)}
 async function share(){if(!room)return;await room.localParticipant.setScreenShareEnabled(!room.localParticipant.isScreenShareEnabled)}

 if(desktop&&!server)return <ServerSetup onConnect={connectServer}/>;
 if(!token)return <Auth onAuth={auth} server={server} onChangeServer={desktop?changeServer:undefined}/>;
 return <div className="app"><aside><div className="brand">VOICEFORGE <span>α</span></div>{desktop&&<button className="server-pill" onClick={changeServer}>◆ {server.replace(/^https?:\/\//,'')}</button>}<div className="section">TEXT</div>{channels.filter(c=>c.type==='text').map(c=><button key={c.id} className={activeText?.id===c.id?'active':''} onClick={()=>setActiveText(c)}># {c.name}</button>)}<div className="section">VOICE</div>{channels.filter(c=>c.type==='voice').map(c=><button key={c.id} className={voice===c.name?'active':''} onClick={()=>joinVoice(c.name)}>🔊 {c.name}</button>)}<div className="user"><b>{username}</b><small>{voice?`В ${voice}`:'Не в голосе'}</small></div></aside><main><header># {activeText?.name||'general'}</header><div className="messages">{messages.map(m=><div className="msg" key={m.id}><b>{m.username}</b><span>{m.body}</span></div>)}</div><div className="composer"><input value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>e.key==='Enter'&&send()} placeholder="Сообщение..."/><button onClick={send}>Отправить</button></div></main><aside className="right"><div className="section">VOICE</div>{voice?<><h3>🔊 {voice}</h3>{participants.map(p=><div className="person" key={p}>● {p}</div>)}<div className="controls"><button onClick={toggleMute}>🎙 Mute</button><button onClick={share}>🖥 Stream</button></div><div ref={mediaRef} className="media"/></>:<p>Выбери голосовой канал</p>}</aside></div>
}
function ServerSetup({onConnect}:{onConnect:(s:string)=>void}){const[s,setS]=useState('');return <div className="auth"><div className="card server-card"><div className="logo-mark">VF</div><h1>VoiceForge</h1><p>Подключение к вашему серверу</p><label>Адрес VoiceForge сервера</label><input autoFocus placeholder="voice.example.com или 1.2.3.4:3001" value={s} onChange={e=>setS(e.target.value)} onKeyDown={e=>e.key==='Enter'&&onConnect(s)}/><button className="primary-wide" onClick={()=>onConnect(s)}>Подключиться</button><small>Сервер должен быть установлен на вашем VPS.</small></div></div>}
function Auth({onAuth,server,onChangeServer}:{onAuth:(m:'login'|'register',u:string,p:string)=>void;server?:string;onChangeServer?:()=>void}){const[u,setU]=useState('');const[p,setP]=useState('');return <div className="auth"><div className="card"><h1>VoiceForge</h1><p>{server?`Сервер: ${server.replace(/^https?:\/\//,'')}`:'Self-hosted voice & screen sharing'}</p><input placeholder="Имя" value={u} onChange={e=>setU(e.target.value)}/><input placeholder="Пароль" type="password" value={p} onChange={e=>setP(e.target.value)} onKeyDown={e=>e.key==='Enter'&&onAuth('login',u,p)}/><div><button onClick={()=>onAuth('login',u,p)}>Войти</button><button className="secondary" onClick={()=>onAuth('register',u,p)}>Регистрация</button></div>{onChangeServer&&<button className="link-button" onClick={onChangeServer}>Сменить сервер</button>}<small>Первый зарегистрированный пользователь становится администратором.</small></div></div>}
createRoot(document.getElementById('root')!).render(<App/>);
