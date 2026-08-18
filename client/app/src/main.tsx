import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  RemoteTrack,
  RemoteParticipant,
} from "livekit-client";
import "./style.css";
import "./enhancements.css";

type Channel = { id: number; name: string; type: "text" | "voice" };
type Msg = { id: number; body: string; created_at: string; username: string };
type DesktopSource = {
  id: string;
  name: string;
  kind: "screen" | "window";
  thumbnail: string;
  icon: string;
};
type DesktopBridge = {
  isDesktop: boolean;
  platform: string;
  version: string;
  getScreenSources: () => Promise<DesktopSource[]>;
  selectScreenSource: (id: string) => Promise<boolean>;
};
type ParticipantState = { mic: boolean; speaking: boolean };
type RemoteStreamState = {
  id: string;
  name: string;
  video?: RemoteTrack;
  audio?: RemoteTrack;
  watching: boolean;
};
type CallStatus = "idle" | "connecting" | "connected" | "reconnecting";
type StreamStatus = "idle" | "selecting" | "starting" | "live" | "stopping";
type ClientSettings = {
  language: "ru" | "en";
  inputDevice: string;
  outputDevice: string;
  cameraDevice: string;
  inputVolume: number;
  outputVolume: number;
  interfaceVolume: number;
  sounds: boolean;
  clickSounds: boolean;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
};
const defaultSettings: ClientSettings = {
  language: "ru",
  inputDevice: "default",
  outputDevice: "default",
  cameraDevice: "default",
  inputVolume: 100,
  outputVolume: 100,
  interfaceVolume: 70,
  sounds: true,
  clickSounds: true,
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
};
function loadSettings(): ClientSettings {
  try {
    return {
      ...defaultSettings,
      ...JSON.parse(localStorage.getItem("vf_settings") || "{}"),
    };
  } catch {
    return defaultSettings;
  }
}
const bridge = (window as unknown as { voiceforgeDesktop?: DesktopBridge })
  .voiceforgeDesktop;
const desktop = Boolean(bridge?.isDesktop),
  platform = bridge?.platform || "web";
const normalize = (value: string) => value.trim().replace(/\/$/, "");
const API = () =>
  desktop
    ? normalize(localStorage.getItem("vf_server") || "")
    : (import.meta as any).env.VITE_API_URL || "";
const savedToken = () =>
  localStorage.getItem("vf_token") || sessionStorage.getItem("vf_token") || "";
const savedUser = () =>
  localStorage.getItem("vf_user") || sessionStorage.getItem("vf_user") || "";
const Logo = ({ compact = false }: { compact?: boolean }) => (
  <div className={"logo " + (compact ? "compact" : "")}>
    <img src="./logo.svg" alt="VoiceForge" />
    <div>
      <strong>
        VOICE<span>FORGE</span>
      </strong>
      <small>SELF-HOSTED VOICE</small>
    </div>
  </div>
);

let audioContext: AudioContext | undefined;
let currentSoundSettings = loadSettings();
type SoundName =
  | "click"
  | "success"
  | "join"
  | "leave"
  | "mute"
  | "unmute"
  | "message"
  | "stream"
  | "stop"
  | "error";
const soundPatterns: Record<SoundName, Array<[number, number, number]>> = {
  click: [[680, 0, 0.035]],
  success: [
    [520, 0, 0.06],
    [780, 0.055, 0.09],
  ],
  join: [
    [420, 0, 0.07],
    [620, 0.06, 0.08],
    [840, 0.13, 0.1],
  ],
  leave: [
    [760, 0, 0.07],
    [480, 0.06, 0.11],
  ],
  mute: [[360, 0, 0.08]],
  unmute: [
    [360, 0, 0.05],
    [610, 0.045, 0.08],
  ],
  message: [
    [880, 0, 0.04],
    [1100, 0.035, 0.055],
  ],
  stream: [
    [330, 0, 0.07],
    [520, 0.06, 0.08],
    [720, 0.12, 0.1],
  ],
  stop: [
    [620, 0, 0.07],
    [330, 0.06, 0.1],
  ],
  error: [
    [230, 0, 0.1],
    [180, 0.08, 0.14],
  ],
};
function playSound(name: SoundName) {
  if (
    !currentSoundSettings.sounds ||
    (name === "click" && !currentSoundSettings.clickSounds)
  )
    return;
  audioContext ??= new AudioContext();
  if (audioContext.state === "suspended") void audioContext.resume();
  const now = audioContext.currentTime;
  for (const [frequency, delay, duration] of soundPatterns[name]) {
    const oscillator = audioContext.createOscillator(),
      gain = audioContext.createGain(),
      start = now + delay;
    oscillator.type = name === "error" ? "square" : "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    const volume =
      (currentSoundSettings.interfaceVolume / 100) *
      (name === "click" ? 0.035 : 0.055);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(0.0001, volume),
      start + 0.006,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.01);
  }
}
function useClickSounds() {
  useEffect(() => {
    const play = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest('button,.channel,[role="button"]')) return;
      playSound("click");
    };
    document.addEventListener("pointerdown", play);
    return () => {
      document.removeEventListener("pointerdown", play);
    };
  }, []);
}

function App() {
  useClickSounds();
  const [server, setServer] = useState(API()),
    [token, setToken] = useState(savedToken()),
    [username, setUsername] = useState(savedUser()),
    [sessionReady, setSessionReady] = useState(!savedToken());
  const [channels, setChannels] = useState<Channel[]>([]),
    [activeText, setActiveText] = useState<Channel | null>(null),
    [messages, setMessages] = useState<Msg[]>([]),
    [text, setText] = useState("");
  const [voice, setVoice] = useState(""),
    [participants, setParticipants] = useState<string[]>([]),
    [participantStates, setParticipantStates] = useState<Record<string, ParticipantState>>({}),
    [remoteStreams, setRemoteStreams] = useState<RemoteStreamState[]>([]),
    [room, setRoom] = useState<Room | null>(null),
    [muted, setMuted] = useState(false),
    [deafened, setDeafened] = useState(false),
    [sharing, setSharing] = useState(false),
    [callStatus, setCallStatus] = useState<CallStatus>("idle"),
    [streamStatus, setStreamStatus] = useState<StreamStatus>("idle"),
    [streamSource, setStreamSource] = useState(""),
    [connectError, setConnectError] = useState(false);
  const [sources, setSources] = useState<DesktopSource[]>([]),
    [sourceLoading, setSourceLoading] = useState(false),
    [notice, setNotice] = useState("");
  const [settings, setSettings] = useState<ClientSettings>(loadSettings()),
    [settingsOpen, setSettingsOpen] = useState(false),
    [membersVisible, setMembersVisible] = useState(true),
    [searchOpen, setSearchOpen] = useState(false),
    [searchQuery, setSearchQuery] = useState(""),
    [moreOpen, setMoreOpen] = useState(false);
  const en = settings.language === "en";
  const mediaRef = useRef<HTMLDivElement>(null),
    deafenedRef = useRef(false),
    joiningRef = useRef(false),
    muteBeforeDeafenRef = useRef(false);
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  useEffect(() => {
    deafenedRef.current = deafened;
  }, [deafened]);
  useEffect(() => {
    currentSoundSettings = settings;
    localStorage.setItem("vf_settings", JSON.stringify(settings));
  }, [settings]);
  useEffect(() => {
    if (!desktop || server) void loadChannels();
  }, [server]);
  useEffect(() => {
    if (activeText && token) void loadMessages();
  }, [activeText, token]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!token) {
      setSessionReady(true);
      return;
    }
    let active = true;
    fetch(`${API()}/api/auth/session`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (active) {
          setUsername(data.user.username);
          setSessionReady(true);
        }
      })
      .catch(() => {
        if (!active) return;
        localStorage.removeItem("vf_token");
        localStorage.removeItem("vf_user");
        sessionStorage.removeItem("vf_token");
        sessionStorage.removeItem("vf_user");
        setToken("");
        setSessionReady(true);
        setNotice(en ? "Session expired. Sign in again." : "Сессия истекла. Войдите снова.");
      });
    return () => {
      active = false;
    };
  }, [token]);
  async function loadChannels() {
    try {
      const response = await fetch(`${API()}/api/channels`);
      if (!response.ok) throw new Error();
      const data = await response.json();
      setChannels(data);
      setActiveText(
        data.find((channel: Channel) => channel.type === "text") || null,
      );
    } catch {
      if (desktop) setServer("");
    }
  }
  async function connectServer(value: string) {
    const clean = normalize(
      value.startsWith("http") ? value : `http://${value}`,
    );
    setConnectError(false);
    try {
      const response = await fetch(`${clean}/api/health`);
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error();
      localStorage.setItem("vf_server", clean);
      localStorage.removeItem("vf_token");
      sessionStorage.removeItem("vf_token");
      sessionStorage.removeItem("vf_user");
      setToken("");
      setServer(clean);
    } catch {
      setConnectError(true);
    }
  }
  function resetCall() {
    setRoom(null);
    setVoice("");
    setParticipants([]);
    setParticipantStates({});
    setRemoteStreams((current) => {
      current.forEach((stream) => {
        stream.video?.detach().forEach((element) => element.remove());
        stream.audio?.detach().forEach((element) => element.remove());
      });
      return [];
    });
    setMuted(false);
    setDeafened(false);
    setSharing(false);
    setCallStatus("idle");
    setStreamStatus("idle");
    setStreamSource("");
    setSources([]);
    if (mediaRef.current) mediaRef.current.innerHTML = "";
  }
  function changeServer() {
    void room?.disconnect();
    resetCall();
    localStorage.removeItem("vf_server");
    localStorage.removeItem("vf_token");
    localStorage.removeItem("vf_user");
    sessionStorage.removeItem("vf_token");
    sessionStorage.removeItem("vf_user");
    setServer("");
    setToken("");
    setChannels([]);
  }
  async function auth(
    mode: "login" | "register",
    user: string,
    password: string,
    remember: boolean,
  ) {
    try {
      const response = await fetch(`${API()}/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user, password, remember }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Ошибка входа");
      const storage = remember ? localStorage : sessionStorage;
      const otherStorage = remember ? sessionStorage : localStorage;
      otherStorage.removeItem("vf_token");
      otherStorage.removeItem("vf_user");
      storage.setItem("vf_token", data.token);
      storage.setItem("vf_user", data.user.username);
      setToken(data.token);
      setUsername(data.user.username);
      playSound("success");
    } catch (error) {
      playSound("error");
      setNotice(error instanceof Error ? error.message : "Ошибка входа");
    }
  }
  async function loadMessages() {
    const response = await fetch(
      `${API()}/api/channels/${activeText!.id}/messages`,
      { headers },
    );
    if (response.ok) setMessages(await response.json());
  }
  async function send() {
    if (!text.trim() || !activeText) return;
    const body = text.trim();
    setText("");
    try {
      const response = await fetch(
        `${API()}/api/channels/${activeText.id}/messages`,
        { method: "POST", headers, body: JSON.stringify({ body }) },
      );
      if (!response.ok) throw new Error();
      await loadMessages();
      playSound("message");
    } catch {
      playSound("error");
      setText(body);
      setNotice(en ? "Could not send the message" : "Не удалось отправить сообщение");
    }
  }
  async function joinVoice(name: string) {
    if (joiningRef.current) return;
    joiningRef.current = true;
    try {
      setCallStatus("connecting");
      await room?.disconnect();
      resetCall();
      const response = await fetch(`${API()}/api/livekit/token`, {
        method: "POST",
        headers,
        body: JSON.stringify({ room: `voice-${name}` }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Не удалось войти в канал");
      const next = new Room({ adaptiveStream: true, dynacast: true });
      const refresh = () => {
        const people = [next.localParticipant, ...Array.from(next.remoteParticipants.values())];
        setParticipants(people.map((participant) => participant.name || participant.identity));
        setParticipantStates(
          Object.fromEntries(
            people.map((participant) => {
              const name = participant.name || participant.identity;
              const microphone = participant.getTrackPublication(Track.Source.Microphone);
              return [name, { mic: Boolean(microphone && !microphone.isMuted), speaking: participant.isSpeaking }];
            }),
          ),
        );
      };
      const upsertRemoteStream = (
        participant: RemoteParticipant,
        track: RemoteTrack,
      ) => {
        const id = participant.identity;
        setRemoteStreams((current) => {
          const existing = current.find((stream) => stream.id === id);
          const nextStream: RemoteStreamState = {
            id,
            name: participant.name || participant.identity,
            video: track.source === Track.Source.ScreenShare ? track : existing?.video,
            audio: track.source === Track.Source.ScreenShareAudio ? track : existing?.audio,
            watching: existing?.watching || false,
          };
          if (nextStream.watching) attachRemoteStream(nextStream);
          return existing
            ? current.map((stream) => (stream.id === id ? nextStream : stream))
            : [...current, nextStream];
        });
      };
      next.on(RoomEvent.ParticipantConnected, refresh);
      next.on(RoomEvent.ParticipantDisconnected, refresh);
      next.on(RoomEvent.ActiveSpeakersChanged, refresh);
      next.on(RoomEvent.TrackMuted, refresh);
      next.on(RoomEvent.TrackUnmuted, refresh);
      next.on(RoomEvent.Disconnected, resetCall);
      next.on(RoomEvent.Reconnecting, () => setCallStatus("reconnecting"));
      next.on(RoomEvent.Reconnected, () => setCallStatus("connected"));
      next.on(RoomEvent.LocalTrackPublished, (publication) => {
        if (publication.source !== Track.Source.ScreenShare) return;
        setSharing(true);
        setStreamStatus("live");
      });
      next.on(RoomEvent.LocalTrackUnpublished, (publication) => {
        if (publication.source !== Track.Source.ScreenShare) return;
        setSharing(false);
        setStreamStatus("idle");
        setStreamSource("");
      });
      next.on(
        RoomEvent.TrackSubscribed,
        (track: RemoteTrack, _publication, participant: RemoteParticipant) => {
          if (
            track.source === Track.Source.ScreenShare ||
            track.source === Track.Source.ScreenShareAudio
          ) {
            upsertRemoteStream(participant, track);
            refresh();
            return;
          }
          const element = track.attach();
          if (track.kind === Track.Kind.Audio) {
            element.dataset.voiceforgeAudio = "true";
            element.muted = deafenedRef.current;
            element.volume = settings.outputVolume / 100;
            document.body.appendChild(element);
          } else mediaRef.current?.appendChild(element);
          refresh();
        },
      );
      next.on(RoomEvent.TrackUnsubscribed, (track) => {
        track.detach().forEach((element) => element.remove());
        if (
          track.source === Track.Source.ScreenShare ||
          track.source === Track.Source.ScreenShareAudio
        ) {
          setRemoteStreams((current) =>
            current
              .map((stream) => ({
                ...stream,
                video: stream.video === track ? undefined : stream.video,
                audio: stream.audio === track ? undefined : stream.audio,
              }))
              .filter((stream) => stream.video || stream.audio),
          );
        }
        refresh();
      });
      await next.connect(data.url, data.token);
      setRoom(next);
      setVoice(name);
      setCallStatus("connected");
      try {
        await next.localParticipant.setMicrophoneEnabled(true, {
          deviceId: settings.inputDevice,
          noiseSuppression: settings.noiseSuppression,
          echoCancellation: settings.echoCancellation,
          autoGainControl: settings.autoGainControl,
        });
        setMuted(false);
        refresh();
      } catch (microphoneError) {
        setMuted(true);
        refresh();
        setNotice(
          settings.language === "en"
            ? "Connected without a microphone. Check the input device in Settings."
            : "Подключено без микрофона. Проверьте устройство ввода в настройках.",
        );
        console.warn("Microphone activation failed", microphoneError);
      }
      if (settings.outputDevice !== "default")
        await next
          .switchActiveDevice("audiooutput", settings.outputDevice)
          .catch(() => false);
      playSound("join");
      refresh();
    } catch (error) {
      playSound("error");
      resetCall();
      setNotice(
        error instanceof Error
          ? error.message
          : en ? "Voice connection error" : "Ошибка голосового подключения",
      );
    } finally {
      joiningRef.current = false;
    }
  }
  async function waitForMediaConnection(activeRoom: Room) {
    if (activeRoom.state === ConnectionState.Connected) return;
    setCallStatus("reconnecting");
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        window.clearInterval(interval);
        reject(new Error(en ? "Voice connection is not ready yet. Try again." : "Голосовое соединение ещё не готово. Попробуйте снова."));
      }, 12_000);
      const interval = window.setInterval(() => {
        if (activeRoom.state !== ConnectionState.Connected) return;
        window.clearTimeout(timeout);
        window.clearInterval(interval);
        setCallStatus("connected");
        resolve();
      }, 150);
    });
  }
  async function leaveVoice() {
    await room?.disconnect();
    resetCall();
    playSound("leave");
  }
  async function toggleMute() {
    if (!room) return;
    if (deafened) {
      setNotice(en ? "Enable sound before turning on the microphone" : "Сначала включите звук, чтобы включить микрофон");
      return;
    }
    try {
      await room.localParticipant.setMicrophoneEnabled(muted);
      setMuted(!muted);
      setParticipantStates((current) => ({
        ...current,
        [username]: { mic: muted, speaking: false },
      }));
      playSound(muted ? "unmute" : "mute");
    } catch {
      playSound("error");
      setNotice(en ? "Could not switch the microphone" : "Не удалось переключить микрофон");
    }
  }
  async function toggleDeafen() {
    const next = !deafened;
    if (!room) return;
    try {
      if (next) {
        muteBeforeDeafenRef.current = muted;
        await room.localParticipant.setMicrophoneEnabled(false);
        setMuted(true);
        setParticipantStates((current) => ({
          ...current,
          [username]: { mic: false, speaking: false },
        }));
      } else if (!muteBeforeDeafenRef.current) {
        await room.localParticipant.setMicrophoneEnabled(true, {
          deviceId: settings.inputDevice,
          noiseSuppression: settings.noiseSuppression,
          echoCancellation: settings.echoCancellation,
          autoGainControl: settings.autoGainControl,
        });
        setMuted(false);
        setParticipantStates((current) => ({
          ...current,
          [username]: { mic: true, speaking: false },
        }));
      }
    } catch {
      playSound("error");
      setNotice(en ? "Could not change sound mode" : "Не удалось изменить режим звука");
      return;
    }
    document
      .querySelectorAll<HTMLMediaElement>('[data-voiceforge-audio="true"]')
      .forEach((element) => {
        element.muted = next;
      });
    setDeafened(next);
    playSound(next ? "mute" : "unmute");
  }
  function attachRemoteStream(stream: RemoteStreamState) {
    if (stream.video) {
      const video = stream.video.attach();
      video.dataset.voiceforgeStream = stream.id;
      mediaRef.current?.appendChild(video);
    }
    if (stream.audio) {
      const audio = stream.audio.attach();
      audio.dataset.voiceforgeAudio = "true";
      audio.dataset.voiceforgeStream = stream.id;
      audio.muted = deafenedRef.current;
      audio.volume = settings.outputVolume / 100;
      document.body.appendChild(audio);
    }
  }
  function toggleRemoteStream(id: string) {
    const target = remoteStreams.find((stream) => stream.id === id);
    if (!target) return;
    if (target.watching) {
      target.video?.detach().forEach((element) => element.remove());
      target.audio?.detach().forEach((element) => element.remove());
    } else {
      attachRemoteStream(target);
    }
    setRemoteStreams((current) =>
      current.map((stream) =>
        stream.id === id ? { ...stream, watching: !stream.watching } : stream,
      ),
    );
  }
  async function share() {
    if (!room) return;
    if (sharing) {
      setStreamStatus("stopping");
      try {
        await room.localParticipant.setScreenShareEnabled(false);
        setSharing(false);
        setStreamStatus("idle");
        setStreamSource("");
        playSound("stop");
      } catch {
        setStreamStatus("live");
        playSound("error");
        setNotice(en ? "Could not stop screen sharing" : "Не удалось остановить трансляцию");
      }
      return;
    }
    if (!bridge) {
      setStreamStatus("starting");
      try {
        await waitForMediaConnection(room);
        await room.localParticipant.setScreenShareEnabled(true);
        setStreamSource(en ? "Screen" : "Экран");
        playSound("stream");
      } catch {
        setStreamStatus("idle");
        playSound("error");
        setNotice(en ? "Could not start screen sharing" : "Не удалось начать трансляцию");
      }
      return;
    }
    setStreamStatus("selecting");
    setSourceLoading(true);
    try {
      const available = await bridge.getScreenSources();
      if (!available.length) throw new Error(en ? "No sharing sources found" : "Источники трансляции не найдены");
      setSources(available);
    } catch (error) {
      setStreamStatus("idle");
      playSound("error");
      setNotice(
        error instanceof Error
          ? error.message
          : en ? "Could not get the window list" : "Не удалось получить список окон",
      );
    } finally {
      setSourceLoading(false);
    }
  }
  async function startShare(source: DesktopSource) {
    if (!room || !bridge) return;
    setStreamStatus("starting");
    setStreamSource(source.name);
    setSourceLoading(true);
    try {
      await waitForMediaConnection(room);
      await bridge.selectScreenSource(source.id);
      await room.localParticipant.setScreenShareEnabled(true, { audio: true });
      playSound("stream");
      setSources([]);
      setNotice(`${en ? "Screen sharing started" : "Трансляция запущена"}: ${source.name}`);
    } catch (error) {
      setStreamStatus("idle");
      setStreamSource("");
      playSound("error");
      setNotice(
        error instanceof Error
          ? error.message
          : en ? "Could not start the selected screen share" : "Не удалось запустить выбранную трансляцию",
      );
    } finally {
      setSourceLoading(false);
    }
  }
  function logout() {
    void room?.disconnect();
    resetCall();
    localStorage.removeItem("vf_token");
    localStorage.removeItem("vf_user");
    sessionStorage.removeItem("vf_token");
    sessionStorage.removeItem("vf_user");
    setToken("");
    setUsername("");
  }
  async function applySettings(next: ClientSettings) {
    setSettings(next);
    currentSoundSettings = next;
    document
      .querySelectorAll<HTMLMediaElement>('[data-voiceforge-audio="true"]')
      .forEach((element) => {
        element.volume = next.outputVolume / 100;
      });
    if (room) {
      try {
        if (next.outputDevice)
          await room.switchActiveDevice(
            "audiooutput",
            next.outputDevice,
            false,
          );
        await room.localParticipant.setMicrophoneEnabled(false);
        await room.localParticipant.setMicrophoneEnabled(true, {
          deviceId: next.inputDevice,
          noiseSuppression: next.noiseSuppression,
          echoCancellation: next.echoCancellation,
          autoGainControl: next.autoGainControl,
          ...({ volume: next.inputVolume / 100 } as any),
        });
        setMuted(false);
      } catch {
        setNotice(
          en ? "Some device settings will apply the next time you join a channel" : "Часть настроек устройства применится при следующем входе в канал",
        );
        playSound("error");
      }
    }
    playSound("success");
    setSettingsOpen(false);
  }
  function changeLanguage(language: "ru" | "en") {
    setSettings((current) => ({ ...current, language }));
  }
  if (
    (import.meta as any).env.DEV &&
    new URLSearchParams(location.search).has("settings-preview")
  )
    return (
      <SettingsModal
        value={settings}
        onApply={setSettings}
        onClose={() => undefined}
      />
    );
  if (!sessionReady)
    return (
      <div className="sessionLoading">
        <Logo />
        <span>{en ? "Restoring session…" : "Восстанавливаем сессию…"}</span>
      </div>
    );
  if (desktop && !server)
    return (
      <>
        <ServerSetup onConnect={connectServer} error={connectError} language={settings.language} onLanguage={changeLanguage} />
        <Toast text={notice} />
      </>
    );
  if (!token)
    return (
      <>
        <Auth
          onAuth={auth}
          server={server}
          language={settings.language}
          onLanguage={changeLanguage}
          onChangeServer={desktop ? changeServer : undefined}
        />
        <Toast text={notice} />
      </>
    );
  return (
    <div className={"shell " + (!membersVisible ? "withoutMembers" : "")}>
      <nav className="rail">
        <Logo compact />
        <button className="railBtn active" title="Открыть главный текстовый канал" onClick={()=>setActiveText(channels.find(channel=>channel.type==="text")||null)}>
          V
        </button>
        <div className="spacer" />
        <button
          className={"railBtn " + (settingsOpen ? "active" : "")}
          title="Настройки звука и устройств"
          onClick={() => setSettingsOpen(true)}
        >
          ⚙
        </button>
      </nav>
      <aside className="sidebar">
        <div className="serverHead">
          <div>
            <small>SERVER</small>
            <b>{server.replace(/^https?:\/\//, "") || "VoiceForge"}</b>
          </div>
          {desktop && (
            <button onClick={changeServer} title="Сменить сервер">
              ⌁
            </button>
          )}
        </div>
        <Section title={en ? "TEXT CHANNELS" : "ТЕКСТОВЫЕ"} />
        {channels
          .filter((channel) => channel.type === "text")
          .map((channel) => (
            <button
              className={
                "channel " + (activeText?.id === channel.id ? "active" : "")
              }
              onClick={() => setActiveText(channel)}
              key={channel.id}
            >
              <i>#</i>
              {channel.name}
            </button>
          ))}
        <Section title={en ? "VOICE CHANNELS" : "ГОЛОСОВЫЕ"} />
        {channels
          .filter((channel) => channel.type === "voice")
          .map((channel) => (
            <React.Fragment key={channel.id}>
              <button
                className={
                  "channel " + (voice === channel.name ? "active" : "")
                }
                onClick={() => void joinVoice(channel.name)}
                disabled={callStatus === "connecting"}
              >
                <i>◖</i>
                {channel.name}
                {voice === channel.name && <span className="signal">▮▮▮</span>}
              </button>
              {voice === channel.name &&
                participants.map((participant) => (
                  <div className="voiceUser" key={participant}>
                    <Avatar name={participant} small />
                    <span>{participant}</span>
                    <span
                      className={`sidebarMic ${participantStates[participant]?.mic ? "on" : "off"}`}
                      title={participantStates[participant]?.mic ? (en ? "Microphone on" : "Микрофон включён") : (en ? "Microphone off" : "Микрофон выключен")}
                    >
                      {participantStates[participant]?.mic ? "🎙" : "🔇"}
                    </span>
                  </div>
                ))}
            </React.Fragment>
          ))}
        <div className="profile">
          <Avatar name={username} />
          <div>
            <b>{username}</b>
            <small>{voice ? (en ? `In ${voice}` : `В ${voice}`) : en ? "Online" : "В сети"}</small>
          </div>
          <button
            className="logoutButton"
            onClick={logout}
            title="Выйти из аккаунта"
          >
            ↪
          </button>
        </div>
      </aside>
      <main className="content">
        <header>
          <div className="title">
            <i>#</i>
            <div>
              <b>{activeText?.name || "general"}</b>
              <small>VoiceForge Community</small>
            </div>
          </div>
          <div className="headerBtns">
            <button
              className={searchOpen ? "active" : ""}
              title="Поиск по сообщениям"
              onClick={() => setSearchOpen(!searchOpen)}
            >
              ⌕
            </button>
            <button
              className={membersVisible ? "active" : ""}
              title="Показать или скрыть участников"
              onClick={() => setMembersVisible(!membersVisible)}
            >
              ☷
            </button>
            <button
              className={moreOpen ? "active" : ""}
              title="Дополнительные действия"
              onClick={() => setMoreOpen(!moreOpen)}
            >
              •••
            </button>
            {moreOpen && (
              <div className="moreMenu">
                <button
                  onClick={() => {
                    void loadMessages();
                    setMoreOpen(false);
                  }}
                >
                  ↻ Обновить сообщения
                </button>
                <button
                  onClick={() => {
                    setSettingsOpen(true);
                    setMoreOpen(false);
                  }}
                >
                  ⚙ Настройки
                </button>
                {desktop && (
                  <button onClick={changeServer}>⌁ Сменить сервер</button>
                )}
                <button onClick={logout}>↪ Выйти</button>
              </div>
            )}
          </div>
        </header>
        {searchOpen && (
          <div className="searchBar">
            <span>⌕</span>
            <input
              autoFocus
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Поиск в текущем канале…"
            />
            <button
              onClick={() => {
                setSearchQuery("");
                setSearchOpen(false);
              }}
            >
              ×
            </button>
          </div>
        )}
        {voice && (
          <section className="voiceStage">
            {streamStatus === "live" && (
              <div className="streamLiveBanner">
                <i />
                <b>{en ? "YOU ARE LIVE" : "ВЫ В ЭФИРЕ"}</b>
                <span>{streamSource || (en ? "Screen sharing" : "Демонстрация экрана")}</span>
              </div>
            )}
            <div className="stageHead">
              <div>
                <em />
                <b>{voice}</b>
                <small>{participants.length} участников</small>
              </div>
              <span className={`connectionBadge ${callStatus}`}>
                {callStatus === "reconnecting"
                  ? en ? "RECONNECTING" : "ВОССТАНОВЛЕНИЕ СВЯЗИ"
                  : callStatus === "connecting"
                    ? en ? "CONNECTING" : "ПОДКЛЮЧЕНИЕ"
                    : sharing
                      ? en ? "● STREAMING" : "● ТРАНСЛЯЦИЯ ИДЁТ"
                      : en ? "● CONNECTED" : "● НА СВЯЗИ"}
              </span>
            </div>
            <div className="peopleGrid">
              {participants.map((participant, index) => (
                <div
                  className={`personCard ${participantStates[participant]?.speaking ? "speaking" : ""} ${participantStates[participant]?.mic ? "micEnabled" : "micDisabled"}`}
                  key={participant}
                >
                  <Avatar name={participant} large />
                  <b>{participant}</b>
                  <div className="voiceStatus">
                    <span className="micState">{participantStates[participant]?.mic ? "🎙" : "🔇"}</span>
                    <small>
                      {index === 0 && muted && deafened
                        ? en ? "Microphone and sound off" : "Микрофон и звук выключены"
                        : participantStates[participant]?.mic
                          ? en ? "Microphone on" : "Микрофон включён"
                          : en ? "Microphone off" : "Микрофон выключен"}
                    </small>
                  </div>
                  <div className="meter" aria-hidden="true">
                    <i /><i /><i /><i />
                  </div>
                </div>
              ))}
            </div>
            {remoteStreams.some((stream) => stream.video) && (
              <div className="remoteStreams">
                {remoteStreams.filter((stream) => stream.video).map((stream) => (
                  <div className={`remoteStreamCard ${stream.watching ? "watching" : ""}`} key={stream.id}>
                    <div>
                      <span className="liveDot" />
                      <p>
                        <b>{stream.name}</b>
                        <small>{en ? "is sharing their screen with audio" : "транслирует экран со звуком"}</small>
                      </p>
                    </div>
                    <button onClick={() => toggleRemoteStream(stream.id)}>
                      {stream.watching
                        ? en ? "Stop watching" : "Закрыть трансляцию"
                        : en ? "Watch stream" : "Смотреть трансляцию"}
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div ref={mediaRef} className="media" />
            <div className="callControls">
              <button
                className={muted ? "danger" : ""}
                onClick={() => void toggleMute()}
              >
                {muted ? "🔇" : "🎙"}
                <small>{muted ? (en ? "Unmute" : "Включить") : en ? "Microphone" : "Микрофон"}</small>
              </button>
              <button
                className={sharing ? "active" : ""}
                onClick={() => void share()}
                disabled={sourceLoading || callStatus !== "connected"}
              >
                ▣
                <small>
                  {streamStatus === "starting"
                    ? en ? "Starting…" : "Запуск…"
                    : streamStatus === "stopping"
                      ? en ? "Stopping…" : "Остановка…"
                      : sourceLoading
                        ? en ? "Loading…" : "Загрузка…"
                    : sharing
                      ? en ? "Stop" : "Остановить"
                      : en ? "Screen" : "Экран"}
                </small>
              </button>
              <button
                className={deafened ? "danger" : ""}
                onClick={() => void toggleDeafen()}
              >
                {deafened ? "🔇" : "🎧"}
                <small>{deafened ? (en ? "Enable sound" : "Включить звук") : en ? "Sound" : "Звук"}</small>
              </button>
              <button className="hang" onClick={() => void leaveVoice()}>
                ⌁<small>{en ? "Leave" : "Выйти"}</small>
              </button>
            </div>
          </section>
        )}
        <section className="chat">
          <div className="messages">
            {!messages.length && (
              <div className="empty">
                <i>#</i>
                <h2>{en ? "Welcome to" : "Добро пожаловать в"} #{activeText?.name || "general"}</h2>
                <p>{en ? "This is the beginning of this channel." : "Это начало истории этого канала."}</p>
              </div>
            )}
            {messages
              .filter(
                (message) =>
                  !searchQuery ||
                  message.body
                    .toLowerCase()
                    .includes(searchQuery.toLowerCase()) ||
                  message.username
                    .toLowerCase()
                    .includes(searchQuery.toLowerCase()),
              )
              .map((message) => (
                <div className="message" key={message.id}>
                  <Avatar name={message.username} />
                  <div>
                    <div className="meta">
                      <b>{message.username}</b>
                      <small>
                        {new Date(message.created_at).toLocaleString()}
                      </small>
                    </div>
                    <p>{message.body}</p>
                  </div>
                </div>
              ))}
          </div>
          <div className="composer">
            <input
              value={text}
              maxLength={2000}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) =>
                event.key === "Enter" && !event.shiftKey && void send()
              }
              placeholder={`${en ? "Message" : "Сообщение в"} #${activeText?.name || "general"}`}
            />
            <span className="charCount">
              {text.length ? `${text.length}/2000` : ""}
            </span>
            <button
              className="send"
              onClick={() => void send()}
              disabled={!text.trim()}
              title="Отправить"
            >
              ➤
            </button>
          </div>
        </section>
      </main>
      <aside
        className={"members " + (!membersVisible ? "membersCollapsed" : "")}
      >
        <Section title={`${en ? "ONLINE" : "В СЕТИ"} — ${participants.length || 1}`} />
        {(participants.length ? participants : [username]).map(
          (participant) => (
            <div className="member" key={participant}>
              <Avatar name={participant} />
              <div>
                <b>{participant}</b>
                <small>{voice ? (en ? "In voice channel" : "В голосовом канале") : "Online"}</small>
              </div>
              <em />
            </div>
          ),
        )}
        <div className="node">
          <small>VOICEFORGE NODE</small>
          <b>Self-hosted</b>
          <span>
            {platform === "linux" ? "Linux Client" : "Windows Client"}
          </span>
        </div>
      </aside>
      {sources.length > 0 && (
        <SharePicker
          sources={sources}
          busy={sourceLoading}
          language={settings.language}
          onSelect={(source) => void startShare(source)}
          onClose={() => setSources([])}
        />
      )}
      {settingsOpen && (
        <SettingsModal
          value={settings}
          onApply={(next) => void applySettings(next)}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      <Toast text={notice} />
    </div>
  );
}

const Section = ({ title }: { title: string }) => (
  <div className="section">
    <span>{title}</span>
  </div>
);
const Avatar = ({
  name,
  small = false,
  large = false,
}: {
  name: string;
  small?: boolean;
  large?: boolean;
}) => (
  <span
    className={"avatar " + (small ? "small " : "") + (large ? "large" : "")}
  >
    {name.slice(0, 1).toUpperCase()}
  </span>
);
const Toast = ({ text }: { text: string }) =>
  text ? (
    <div className="toast" role="status">
      {text}
    </div>
  ) : null;
function SharePicker({
  sources,
  busy,
  language,
  onSelect,
  onClose,
}: {
  sources: DesktopSource[];
  busy: boolean;
  language: "ru" | "en";
  onSelect: (source: DesktopSource) => void;
  onClose: () => void;
}) {
  const en = language === "en";
  const initial = sources.some((source) => source.kind === "screen")
    ? "screen"
    : "window";
  const [tab, setTab] = useState<"screen" | "window">(initial);
  const visible = sources.filter((source) => source.kind === tab);
  return (
    <div
      className="modalBackdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section className="sharePicker">
        <header>
          <div>
            <h2>{en ? "Choose a source" : "Выберите источник"}</h2>
            <p>{en ? "Share the entire desktop or a single application" : "Покажите весь рабочий стол или только одно приложение"}</p>
          </div>
          <button onClick={onClose} title="Закрыть">
            ×
          </button>
        </header>
        <div className="sourceTabs">
          <button
            className={tab === "screen" ? "active" : ""}
            onClick={() => setTab("screen")}
          >
            {en ? "Desktops" : "Рабочие столы"}
          </button>
          <button
            className={tab === "window" ? "active" : ""}
            onClick={() => setTab("window")}
          >
            {en ? "Application windows" : "Окна приложений"}
          </button>
        </div>
        <div className="sourceGrid">
          {visible.map((source) => (
            <button
              className="sourceCard"
              key={source.id}
              onClick={() => onSelect(source)}
              disabled={busy}
            >
              <img src={source.thumbnail} alt="" />
              <span>
                {source.icon && <img src={source.icon} alt="" />}
                <b>{source.name}</b>
              </span>
            </button>
          ))}
          {!visible.length && (
            <p className="noSources">{en ? "No sources of this type are available" : "Нет доступных источников этого типа"}</p>
          )}
        </div>
      </section>
    </div>
  );
}
function SettingsModal({
  value,
  onApply,
  onClose,
}: {
  value: ClientSettings;
  onApply: (value: ClientSettings) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(value),
    [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
    [testing, setTesting] = useState(false),
    [level, setLevel] = useState(0),
    [deviceError, setDeviceError] = useState("");
  const en = draft.language === "en";
  const streamRef = useRef<MediaStream | null>(null),
    frameRef = useRef(0);
  const list = async (requestPermission = false) => {
    try {
      if (requestPermission) {
        const temp = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        temp.getTracks().forEach((track) => track.stop());
      }
      setDevices(await navigator.mediaDevices.enumerateDevices());
      setDeviceError("");
    } catch {
      setDeviceError(
        en ? "Device access denied. Allow microphone access in Windows." : "Нет доступа к устройствам. Разрешите микрофон в системе.",
      );
    }
  };
  useEffect(() => {
    void list();
    return () => stopTest();
  }, []);
  const update = <K extends keyof ClientSettings>(
    key: K,
    next: ClientSettings[K],
  ) => setDraft((current) => ({ ...current, [key]: next }));
  const options = (kind: MediaDeviceKind) => [
    { deviceId: "default", label: en ? "System default device" : "Системное устройство по умолчанию" },
    ...devices
      .filter((device) => device.kind === kind)
      .map((device, index) => ({
        deviceId: device.deviceId,
        label:
          device.label ||
          `${kind === "audioinput" ? (en ? "Microphone" : "Микрофон") : kind === "audiooutput" ? (en ? "Speakers" : "Динамики") : en ? "Camera" : "Камера"} ${index + 1}`,
      })),
  ];
  async function startTest() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: draft.inputDevice,
          noiseSuppression: draft.noiseSuppression,
          echoCancellation: draft.echoCancellation,
          autoGainControl: draft.autoGainControl,
        },
        video: false,
      });
      streamRef.current = stream;
      const context = new AudioContext(),
        source = context.createMediaStreamSource(stream),
        analyser = context.createAnalyser(),
        data = new Uint8Array(analyser.fftSize);
      source.connect(analyser);
      setTesting(true);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const sample of data) {
          const normalized = (sample - 128) / 128;
          sum += normalized * normalized;
        }
        setLevel(
          Math.min(
            100,
            Math.sqrt(sum / data.length) * 240 * (draft.inputVolume / 100),
          ),
        );
        frameRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      setDeviceError(en ? "Could not start the microphone test" : "Не удалось включить тест микрофона");
    }
  }
  function stopTest() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    cancelAnimationFrame(frameRef.current);
    setTesting(false);
    setLevel(0);
  }
  return (
    <div className="modalBackdrop">
      <section className="settingsModal">
        <header>
          <div>
            <h2>{en ? "VoiceForge Settings" : "Настройки VoiceForge"}</h2>
            <p>{en ? "Audio, devices and client behavior" : "Звук, устройства и поведение клиента"}</p>
          </div>
          <button onClick={onClose}>×</button>
        </header>
        <div className="settingsBody">
          <nav>
            <button
              className="active"
              onClick={() =>
                document
                  .getElementById("voice-settings")
                  ?.scrollIntoView({ behavior: "smooth" })
              }
            >
              🎙 {en ? "Voice & Video" : "Голос и видео"}
            </button>
            <button
              onClick={() =>
                document
                  .getElementById("sound-settings")
                  ?.scrollIntoView({ behavior: "smooth" })
              }
            >
              🔔 {en ? "Interface sounds" : "Звуки интерфейса"}
            </button>
          </nav>
          <main>
            <section className="settingsSection">
              <h3>{en ? "Language" : "Язык"}</h3>
              <SettingSelect
                label={en ? "Interface language" : "Язык интерфейса"}
                value={draft.language}
                options={[
                  { deviceId: "ru", label: "Русский" },
                  { deviceId: "en", label: "English" },
                ]}
                onChange={(next) => update("language", next as "ru" | "en")}
              />
            </section>
            <section className="settingsSection" id="voice-settings">
              <h3>{en ? "Devices" : "Устройства"}</h3>
              <SettingSelect
                label={en ? "Microphone" : "Микрофон"}
                value={draft.inputDevice}
                options={options("audioinput")}
                onChange={(next) => update("inputDevice", next)}
              />
              <SettingSelect
                label={en ? "Speakers / headphones" : "Динамики / наушники"}
                value={draft.outputDevice}
                options={options("audiooutput")}
                onChange={(next) => update("outputDevice", next)}
              />
              <SettingSelect
                label={en ? "Camera" : "Камера"}
                value={draft.cameraDevice}
                options={options("videoinput")}
                onChange={(next) => update("cameraDevice", next)}
              />
              <button
                className="secondaryButton"
                onClick={() => void list(true)}
              >
                ↻ {en ? "Refresh device list" : "Обновить список устройств"}
              </button>
              {deviceError && <p className="settingsError">{deviceError}</p>}
            </section>
            <section className="settingsSection">
              <h3>{en ? "Volume" : "Громкость"}</h3>
              <SettingRange
                label={en ? "Microphone gain" : "Усиление микрофона"}
                value={draft.inputVolume}
                onChange={(next) => update("inputVolume", next)}
              />
              <SettingRange
                label={en ? "People volume" : "Громкость собеседников"}
                value={draft.outputVolume}
                onChange={(next) => update("outputVolume", next)}
              />
              <SettingRange
                label={en ? "Interface sound volume" : "Громкость звуков интерфейса"}
                value={draft.interfaceVolume}
                onChange={(next) => update("interfaceVolume", next)}
              />
              <div className="micTest">
                <div>
                  <b>{en ? "Microphone test" : "Тест микрофона"}</b>
                  <small>{en ? "Say a few words and check the level" : "Скажите несколько слов и проверьте уровень"}</small>
                </div>
                <div className="levelTrack">
                  <i style={{ width: `${level}%` }} />
                </div>
                <button
                  onClick={() => (testing ? stopTest() : void startTest())}
                >
                  {testing ? (en ? "Stop" : "Остановить") : en ? "Start test" : "Начать тест"}
                </button>
              </div>
            </section>
            <section className="settingsSection">
              <h3>{en ? "Voice processing" : "Обработка голоса"}</h3>
              <SettingToggle
                label={en ? "Noise suppression" : "Шумоподавление"}
                hint={en ? "Reduces fan and constant background noise" : "Убирает вентилятор и постоянный фоновый шум"}
                checked={draft.noiseSuppression}
                onChange={(next) => update("noiseSuppression", next)}
              />
              <SettingToggle
                label={en ? "Echo cancellation" : "Подавление эха"}
                hint={en ? "Prevents speaker sound from returning" : "Предотвращает возврат звука из динамиков"}
                checked={draft.echoCancellation}
                onChange={(next) => update("echoCancellation", next)}
              />
              <SettingToggle
                label={en ? "Automatic gain" : "Автоматическое усиление"}
                hint={en ? "Balances quiet and loud speech" : "Выравнивает тихий и громкий голос"}
                checked={draft.autoGainControl}
                onChange={(next) => update("autoGainControl", next)}
              />
            </section>
            <section className="settingsSection" id="sound-settings">
              <h3>{en ? "Interface sounds" : "Звуки интерфейса"}</h3>
              <SettingToggle
                label={en ? "Sound notifications" : "Звуковые уведомления"}
                hint={en ? "Join, leave, messages, streams and errors" : "Вход, выход, сообщения, стрим и ошибки"}
                checked={draft.sounds}
                onChange={(next) => update("sounds", next)}
              />
              <SettingToggle
                label={en ? "Button click sound" : "Звук нажатия кнопок"}
                hint={en ? "A short sound for each action" : "Короткий звук для каждого действия"}
                checked={draft.clickSounds}
                onChange={(next) => update("clickSounds", next)}
              />
              <button
                className="secondaryButton"
                onClick={() => {
                  currentSoundSettings = draft;
                  playSound("join");
                }}
              >
                ▶ {en ? "Test sound" : "Проверить звук"}
              </button>
            </section>
          </main>
        </div>
        <footer>
          <button
            className="resetButton"
            onClick={() => setDraft(defaultSettings)}
          >
            {en ? "Reset" : "Сбросить"}
          </button>
          <span />
          <button onClick={onClose}>{en ? "Cancel" : "Отмена"}</button>
          <button
            className="saveButton"
            onClick={() => {
              stopTest();
              onApply(draft);
            }}
          >
            {en ? "Save changes" : "Сохранить изменения"}
          </button>
        </footer>
      </section>
    </div>
  );
}
function SettingSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ deviceId: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="settingField">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option value={option.deviceId} key={option.deviceId}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
function SettingRange({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="settingRange">
      <span>
        <b>{label}</b>
        <em>{value}%</em>
      </span>
      <input
        type="range"
        min="0"
        max="100"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
function SettingToggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="settingToggle">
      <span>
        <b>{label}</b>
        <small>{hint}</small>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <i />
    </label>
  );
}
function ServerSetup({
  onConnect,
  error,
  language,
  onLanguage,
}: {
  onConnect: (server: string) => void;
  error: boolean;
  language: "ru" | "en";
  onLanguage: (language: "ru" | "en") => void;
}) {
  const [value, setValue] = useState("");
  const en = language === "en";
  return (
    <div className="gate">
      <LanguageSwitch language={language} onChange={onLanguage} />
      <div className="aurora a1" />
      <div className="aurora a2" />
      <div className="gatePanel">
        <Logo />
        <span className="eyebrow">PRIVATE • FAST • SELF-HOSTED</span>
        <h1>
          {en ? "Connect to your" : "Подключись к своему"}
          <br />
          <em>VoiceForge</em> {en ? "server" : "серверу"}
        </h1>
        <p>
          {en ? "Voice, text and screen sharing on infrastructure you control." : "Голос, текст и трансляция экрана на инфраструктуре, которую контролируешь ты."}
        </p>
        <div className="connectBox">
          <label>{en ? "SERVER ADDRESS" : "АДРЕС СЕРВЕРА"}</label>
          <div className="serverInput">
            <span>⌁</span>
            <input
              autoFocus
              placeholder={en ? "voice.example.com or 1.2.3.4:3001" : "voice.example.com или 1.2.3.4:3001"}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && onConnect(value)}
            />
          </div>
          {error && (
            <div className="error">
              {en ? "Could not connect. Check the address and VPS." : "Не удалось подключиться. Проверь адрес и VPS."}
            </div>
          )}
          <button
            className="primary"
            onClick={() => onConnect(value)}
            disabled={!value.trim()}
          >
            {en ? "Connect" : "Подключиться"} <span>→</span>
          </button>
          <small>Windows • Ubuntu/Debian • AppImage</small>
        </div>
      </div>
      <div className="visual">
        <div className="orb">
          <img src="./logo.svg" alt="" />
        </div>
        <div className="wave">
          {Array.from({ length: 11 }).map((_, index) => (
            <i key={index} />
          ))}
        </div>
        <small>VOICE LINK ENCRYPTED</small>
      </div>
    </div>
  );
}
function Auth({
  onAuth,
  server,
  onChangeServer,
  language,
  onLanguage,
}: {
  onAuth: (
    mode: "login" | "register",
    user: string,
    password: string,
    remember: boolean,
  ) => void;
  server?: string;
  onChangeServer?: () => void;
  language: "ru" | "en";
  onLanguage: (language: "ru" | "en") => void;
}) {
  const [user, setUser] = useState(""),
    [password, setPassword] = useState(""),
    [mode, setMode] = useState<"login" | "register">("login"),
    [remember, setRemember] = useState(true);
  const en = language === "en";
  const valid = user.trim().length >= 2 && password.length >= 8;
  return (
    <div className="gate authGate">
      <LanguageSwitch language={language} onChange={onLanguage} />
      <div className="aurora a1" />
      <div className="authPanel">
        <Logo />
        <div className="tabs">
          <button
            className={mode === "login" ? "active" : ""}
            onClick={() => setMode("login")}
          >
            {en ? "Login" : "Вход"}
          </button>
          <button
            className={mode === "register" ? "active" : ""}
            onClick={() => setMode("register")}
          >
            {en ? "Register" : "Регистрация"}
          </button>
        </div>
        <h1>{mode === "login" ? (en ? "Welcome back" : "С возвращением") : en ? "Create account" : "Создать аккаунт"}</h1>
        <p className="serverLabel">● {server?.replace(/^https?:\/\//, "")}</p>
        <label>{en ? "USERNAME" : "ИМЯ ПОЛЬЗОВАТЕЛЯ"}</label>
        <input
          className="field"
          autoFocus
          value={user}
          onChange={(event) => setUser(event.target.value)}
          placeholder="Nikita"
        />
        <label>{en ? "PASSWORD" : "ПАРОЛЬ"}</label>
        <input
          className="field"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={en ? "At least 8 characters" : "Минимум 8 символов"}
          onKeyDown={(event) =>
            event.key === "Enter" &&
            valid &&
            onAuth(mode, user, password, remember)
          }
        />
        {mode === "login" && (
          <label className="rememberRow">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />
            <span>
              <b>{en ? "Remember me" : "Запомнить меня"}</b>
              <small>{en ? "Do not ask for the password for 30 days" : "Не спрашивать пароль 30 дней"}</small>
            </span>
          </label>
        )}
        <button
          className="primary"
          disabled={!valid}
          onClick={() => onAuth(mode, user, password, remember)}
        >
          {mode === "login" ? (en ? "Sign in to VoiceForge" : "Войти в VoiceForge") : en ? "Register" : "Зарегистрироваться"}{" "}
          <span>→</span>
        </button>
        {onChangeServer && (
          <button className="link" onClick={onChangeServer}>
            ← {en ? "Change server" : "Сменить сервер"}
          </button>
        )}
      </div>
    </div>
  );
}
function LanguageSwitch({
  language,
  onChange,
}: {
  language: "ru" | "en";
  onChange: (language: "ru" | "en") => void;
}) {
  return (
    <div className="languageSwitch" aria-label="Language">
      <button className={language === "ru" ? "active" : ""} onClick={() => onChange("ru")}>RU</button>
      <button className={language === "en" ? "active" : ""} onClick={() => onChange("en")}>EN</button>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
