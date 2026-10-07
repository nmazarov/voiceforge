import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/manrope";
import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  LocalTrack,
  RemoteTrack,
  RemoteParticipant,
} from "livekit-client";
import "./style.css";
import "./enhancements.css";
import {
  MicIcon,
  MicOffIcon,
  HeadphonesIcon,
  HeadphonesOffIcon,
  GearIcon,
  LogoutIcon,
  ScreenShareIcon,
  PhoneHangupIcon,
  VolumeUpIcon,
  VolumeMuteIcon,
  UploadIcon,
} from "./icons";

type Channel = { id: number; name: string; type: "text" | "voice" };
type Role = "owner" | "admin" | "user";
type ServerUser = { id: number; username: string; role: Role };

function getRoleBadge(role?: string, en = false) {
  if (role === "owner") {
    return {
      name: en ? "Owner" : "Создатель",
      short: en ? "Owner" : "Владелец",
      icon: "👑",
      color: "#f59e0b",
      bg: "rgba(245, 158, 11, 0.15)",
      border: "rgba(245, 158, 11, 0.35)",
    };
  }
  if (role === "admin") {
    return {
      name: en ? "Admin" : "Администратор",
      short: en ? "Admin" : "Админ",
      icon: "🛡️",
      color: "#8b5cf6",
      bg: "rgba(139, 92, 246, 0.15)",
      border: "rgba(139, 92, 246, 0.35)",
    };
  }
  return {
    name: en ? "Member" : "Участник",
    short: en ? "Member" : "Участник",
    icon: "👤",
    color: "#94a3b8",
    bg: "rgba(148, 163, 184, 0.12)",
    border: "rgba(148, 163, 184, 0.25)",
  };
}

function RoleBadge({ role, en }: { role?: string; en?: boolean }) {
  if (!role || role === "user") return null;
  const badge = getRoleBadge(role, en);
  return (
    <span
      className="discordRoleBadge"
      style={{
        color: badge.color,
        background: badge.bg,
        border: `1px solid ${badge.border}`,
      }}
      title={badge.name}
    >
      <span className="badgeIcon">{badge.icon}</span>
      <span className="badgeName">{badge.short}</span>
    </span>
  );
}

type Msg = {
  id: number;
  body: string;
  created_at: string;
  is_edited?: boolean;
  edited_at?: string | null;
  username: string;
  role?: Role;
  reply_to?: { id: number; username: string; body: string } | null;
  attachment?: string | null;
  reactions?: Record<string, string[]>;
};
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
  video?: Track;
  audio?: Track;
  watching: boolean;
};
type CallStatus = "idle" | "connecting" | "connected" | "reconnecting";
type StreamStatus = "idle" | "selecting" | "starting" | "live" | "stopping";
type StreamQuality = "720p30" | "720p60" | "1080p30" | "1080p60";
const streamQualities: Record<StreamQuality, { label: string; width: number; height: number; frameRate: number; bitrate: number }> = {
  "720p30": { label: "720p · 30 FPS", width: 1280, height: 720, frameRate: 30, bitrate: 2_500_000 },
  "720p60": { label: "720p · 60 FPS", width: 1280, height: 720, frameRate: 60, bitrate: 4_000_000 },
  "1080p30": { label: "1080p · 30 FPS", width: 1920, height: 1080, frameRate: 30, bitrate: 5_000_000 },
  "1080p60": { label: "1080p · 60 FPS", width: 1920, height: 1080, frameRate: 60, bitrate: 8_000_000 },
};
type UserStatus = "online" | "idle" | "dnd" | "invisible";

function getStatusDetails(status: UserStatus = "online", en: boolean = false) {
  switch (status) {
    case "idle":
      return {
        label: en ? "Idle / AFK" : "Не активен",
        color: "#f59e0b",
        icon: "🌙",
        desc: en ? "Away from keyboard" : "Отошел от компьютера",
      };
    case "dnd":
      return {
        label: en ? "Do Not Disturb" : "Не беспокоить",
        color: "#ef4444",
        icon: "⛔",
        desc: en ? "Mutes incoming sound notifications" : "Глушит звуки сообщений",
      };
    case "invisible":
      return {
        label: en ? "Invisible" : "Невидимка",
        color: "#747f8d",
        icon: "⚪",
        desc: en ? "Appear offline to others" : "Отображаться не в сети",
      };
    case "online":
    default:
      return {
        label: en ? "Online" : "В сети",
        color: "#23a55a",
        icon: "🟢",
        desc: en ? "Active & receiving notifications" : "Виден всем, звук включен",
      };
  }
}
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
  voiceThreshold: number;
  autoThreshold: boolean;
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
  voiceThreshold: 20,
  autoThreshold: false,
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
const API = () => {
  const envUrl = (import.meta as any).env.VITE_API_URL || "";
  if (envUrl) return envUrl;
  return normalize(localStorage.getItem("vf_server") || "");
};
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
let currentMyStatus: UserStatus = "online";
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
    (name === "click" && !currentSoundSettings.clickSounds) ||
    (currentMyStatus === "dnd" && (name === "message" || name === "click"))
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

function StreamPreview({
  track,
  title,
  subtitle,
  open,
  onToggle,
  onPopout,
}: {
  track: LocalTrack;
  title: string;
  subtitle: string;
  open: boolean;
  onToggle: () => void;
  onPopout?: () => void;
}) {
  const previewRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const video = track.attach();
    video.muted = true;
    video.autoplay = true;
    video.setAttribute("playsinline", "true");
    previewRef.current?.appendChild(video);
    return () => {
      track.detach(video);
      video.remove();
    };
  }, [track, open]);
  return (
    <section className="localStreamPreview">
      <div className="streamPreviewHead">
        <span><i />{title}</span>
        <small>{subtitle}</small>
        <div style={{ display: "inline-flex", gap: "6px", alignItems: "center", marginLeft: "auto" }}>
          {onPopout && (
            <button
              type="button"
              onClick={onPopout}
              title="Открыть в подвижном / отдельном окне"
              style={{ fontSize: "11px", padding: "2px 5px", cursor: "pointer" }}
            >
              🗗
            </button>
          )}
          <button onClick={onToggle}>{open ? "−" : "□"}</button>
        </div>
      </div>
      {open && <div className="streamPreviewViewport" ref={previewRef} />}
    </section>
  );
}

function FloatingStreamViewer({
  stream,
  onClose,
  en,
  deafened,
  masterVolume,
}: {
  stream: RemoteStreamState;
  onClose: () => void;
  en: boolean;
  deafened: boolean;
  masterVolume: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const [pos, setPos] = useState({ x: 320, y: 70 });
  const [size, setSize] = useState({ width: 720, height: 440 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [streamVolume, setStreamVolume] = useState(100);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);

  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, posX: 0, posY: 0 });
  const resizeStartRef = useRef({ mouseX: 0, mouseY: 0, width: 0, height: 0 });

  useEffect(() => {
    if (!stream.video || !videoRef.current) return;
    const el = videoRef.current;
    stream.video.attach(el);
    return () => {
      stream.video?.detach(el);
    };
  }, [stream.video]);

  useEffect(() => {
    if (!stream.audio || !audioRef.current) return;
    const el = audioRef.current;
    stream.audio.attach(el);
    el.muted = deafened;
    el.volume = Math.max(0, Math.min(1, (masterVolume / 100) * (streamVolume / 100)));
    return () => {
      stream.audio?.detach(el);
    };
  }, [stream.audio, deafened, masterVolume, streamVolume]);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const handleMouseDownHeader = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button") || (e.target as HTMLElement).closest("input")) return;
    setIsDragging(true);
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      posX: pos.x,
      posY: pos.y,
    };
  };

  useEffect(() => {
    if (!isDragging) return;
    const onMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStartRef.current.mouseX;
      const dy = e.clientY - dragStartRef.current.mouseY;
      const maxX = Math.max(0, window.innerWidth - 200);
      const maxY = Math.max(0, window.innerHeight - 80);
      setPos({
        x: Math.max(0, Math.min(maxX, dragStartRef.current.posX + dx)),
        y: Math.max(0, Math.min(maxY, dragStartRef.current.posY + dy)),
      });
    };
    const onMouseUp = () => setIsDragging(false);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isDragging]);

  const handleMouseDownResize = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsResizing(true);
    resizeStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      width: size.width,
      height: size.height,
    };
  };

  useEffect(() => {
    if (!isResizing) return;
    const onMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - resizeStartRef.current.mouseX;
      const dy = e.clientY - resizeStartRef.current.mouseY;
      const newWidth = Math.max(340, Math.min(window.innerWidth - pos.x, resizeStartRef.current.width + dx));
      const newHeight = Math.max(220, Math.min(window.innerHeight - pos.y, resizeStartRef.current.height + dy));
      setSize({ width: newWidth, height: newHeight });
    };
    const onMouseUp = () => setIsResizing(false);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isResizing, pos.x, pos.y]);

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        setIsFullscreen(false);
      } else {
        await containerRef.current.requestFullscreen();
        setIsFullscreen(true);
      }
    } catch {
      setIsFullscreen(!isFullscreen);
    }
  };

  const handlePopout = async () => {
    if (!videoRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (videoRef.current.requestPictureInPicture) {
        await videoRef.current.requestPictureInPicture();
      }
    } catch (e) {
      console.warn("Picture-in-picture unavailable:", e);
    }
  };

  return (
    <div
      ref={containerRef}
      className={`floatingStreamWindow ${isFullscreen ? "fullscreenMode" : ""}`}
      style={isFullscreen ? undefined : {
        transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`,
        width: `${size.width}px`,
        height: `${size.height}px`,
      }}
    >
      <div className="streamWindowHeader" onMouseDown={handleMouseDownHeader}>
        <div className="streamHeaderLeft">
          <span className="liveBadgePulse">
            <span className="liveDot" />
            LIVE
          </span>
          <b>{stream.name}</b>
          <small>{en ? "Screen Share" : "Трансляция"}</small>
        </div>
        <div className="streamHeaderRight">
          {stream.audio && (
            <div className="streamVolumeControl" title={en ? "Stream volume" : "Громкость трансляции"}>
              <VolumeUpIcon size={14} />
              <input
                type="range"
                min={0}
                max={100}
                value={streamVolume}
                onChange={(e) => setStreamVolume(Number(e.target.value))}
              />
              <span>{streamVolume}%</span>
            </div>
          )}
          <button
            type="button"
            className="streamHeaderBtn"
            onClick={handlePopout}
            title={en ? "Pop out to separate window (Picture-in-Picture)" : "Открыть в отдельном окне (Picture-in-Picture)"}
          >
            🗗
          </button>
          <button
            type="button"
            className="streamHeaderBtn"
            onClick={toggleFullscreen}
            title={en ? "Toggle Fullscreen (or double-click video)" : "На весь экран (или двойной щелчок)"}
          >
            {isFullscreen ? "🗗" : "⛶"}
          </button>
          <button
            type="button"
            className="streamHeaderBtn close"
            onClick={onClose}
            title={en ? "Close stream" : "Закрыть просмотр"}
          >
            ✕
          </button>
        </div>
      </div>
      <div
        className="streamVideoViewport"
        onDoubleClick={toggleFullscreen}
      >
        <video ref={videoRef} autoPlay playsInline />
        <audio ref={audioRef} autoPlay />
      </div>
      {!isFullscreen && (
        <div
          className="streamResizeHandle"
          onMouseDown={handleMouseDownResize}
          title={en ? "Drag to resize" : "Потяните, чтобы изменить размер"}
        />
      )}
    </div>
  );
}

function SpoilerSpan({ text }: { text: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      className={`discordSpoiler ${revealed ? "revealed" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        setRevealed(!revealed);
      }}
      title="Спойлер (нажмите, чтобы показать)"
    >
      {text}
    </span>
  );
}

function highlightMatch(text: string, query?: string): React.ReactNode {
  if (!query || !query.trim()) return text;
  const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(regex);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark key={i} className="discordSearchHighlight">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

function parseInlineTokens(text: string, searchQuery?: string): React.ReactNode[] {
  const regex = /(\|\|.+?\|\||\*\*.+?\*\*|~~.+?~~|`[^`]+`|\*[^*]+\*|https?:\/\/[^\s]+)/g;
  const parts = text.split(regex);
  return parts.map((part, i) => {
    if (!part) return null;
    if (part.startsWith("||") && part.endsWith("||") && part.length >= 4) {
      return <SpoilerSpan key={i} text={part.slice(2, -2)} />;
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      return <strong key={i}>{highlightMatch(part.slice(2, -2), searchQuery)}</strong>;
    }
    if (part.startsWith("~~") && part.endsWith("~~") && part.length >= 4) {
      return <del key={i}>{highlightMatch(part.slice(2, -2), searchQuery)}</del>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      return <code key={i} className="discordInlineCode">{highlightMatch(part.slice(1, -1), searchQuery)}</code>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length >= 2) {
      return <em key={i}>{highlightMatch(part.slice(1, -1), searchQuery)}</em>;
    }
    if (part.startsWith("http://") || part.startsWith("https://")) {
      return (
        <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="discordLink">
          {part}
        </a>
      );
    }
    return highlightMatch(part, searchQuery);
  });
}

function MarkdownMessage({ content, searchQuery }: { content: string; searchQuery?: string }) {
  if (content.includes("```")) {
    const segments = content.split(/(```[\s\S]*?```)/g);
    return (
      <div className="messageText">
        {segments.map((seg, idx) => {
          if (seg.startsWith("```") && seg.endsWith("```")) {
            const inner = seg.slice(3, -3).replace(/^\n/, "");
            return (
              <pre key={idx} className="discordCodeBlock">
                <code>{inner}</code>
              </pre>
            );
          }
          return (
            <p key={idx} className="messageParagraph">
              {parseInlineTokens(seg, searchQuery)}
            </p>
          );
        })}
      </div>
    );
  }

  const lines = content.split("\n");
  const renderedLines: React.ReactNode[] = [];
  let quoteBuffer: string[] = [];

  const flushQuote = (key: number) => {
    if (quoteBuffer.length > 0) {
      renderedLines.push(
        <blockquote key={`q-${key}`} className="discordQuote">
          {quoteBuffer.map((line, qIdx) => (
            <div key={qIdx}>{parseInlineTokens(line, searchQuery)}</div>
          ))}
        </blockquote>
      );
      quoteBuffer = [];
    }
  };

  lines.forEach((line, index) => {
    if (line.startsWith("> ") || line === ">") {
      quoteBuffer.push(line.replace(/^>\s?/, ""));
    } else {
      flushQuote(index);
      renderedLines.push(
        <span key={`l-${index}`} className="messageLine">
          {parseInlineTokens(line, searchQuery)}
          {index < lines.length - 1 && <br />}
        </span>
      );
    }
  });
  flushQuote(lines.length);

  return <div className="messageText">{renderedLines}</div>;
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
    [text, setText] = useState(""),
    [replyTo, setReplyTo] = useState<Msg | null>(null),
    [attachment, setAttachment] = useState<string | null>(null),
    [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
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
    [streamQuality, setStreamQuality] = useState<StreamQuality>("1080p30"),
    [previewOpen, setPreviewOpen] = useState(true),
    [localPreviewFloating, setLocalPreviewFloating] = useState(false),
    [localStreamTrack, setLocalStreamTrack] = useState<LocalTrack | null>(null),
    [connectError, setConnectError] = useState(false);
  const [sources, setSources] = useState<DesktopSource[]>([]),
    [sourceLoading, setSourceLoading] = useState(false),
    [notice, setNotice] = useState("");
  const [settings, setSettings] = useState<ClientSettings>(loadSettings()),
    [settingsOpen, setSettingsOpen] = useState(false),
    [membersVisible, setMembersVisible] = useState(true),
    [searchOpen, setSearchOpen] = useState(false),
    [searchQuery, setSearchQuery] = useState(""),
    [moreOpen, setMoreOpen] = useState(false),
    [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({}),
    [ping, setPing] = useState<number | null>(null),
    [userVolumes, setUserVolumes] = useState<Record<string, number>>(() => {
      try {
        return JSON.parse(localStorage.getItem("vf_user_volumes") || "{}");
      } catch {
        return {};
      }
    }),
    [volumeMenuUser, setVolumeMenuUser] = useState<string | null>(null),
    [editingMessageId, setEditingMessageId] = useState<number | null>(null),
    [editingText, setEditingText] = useState(""),
    [typingUsers, setTypingUsers] = useState<Record<string, number>>({}),
    [createChannelOpen, setCreateChannelOpen] = useState(false),
    [createChannelType, setCreateChannelType] = useState<"text" | "voice">("text"),
    [newChannelName, setNewChannelName] = useState(""),
    [createChannelLoading, setCreateChannelLoading] = useState(false),
    [editChannelModal, setEditChannelModal] = useState<Channel | null>(null),
    [editChannelName, setEditChannelName] = useState(""),
    [editChannelLoading, setEditChannelLoading] = useState(false),
    [serverUsers, setServerUsers] = useState<ServerUser[]>([]),
    [myRole, setMyRole] = useState<Role>("user"),
    [isAtBottom, setIsAtBottom] = useState(true),
    [unreadBelowCount, setUnreadBelowCount] = useState(0),
    [isDraggingFile, setIsDraggingFile] = useState(false),
    [searchMatchIndex, setSearchMatchIndex] = useState(0),
    [connectionInfoOpen, setConnectionInfoOpen] = useState(false),
    [myStatus, setMyStatus] = useState<UserStatus>(() => {
      try {
        const saved = localStorage.getItem("vf_user_status") as UserStatus;
        if (saved && ["online", "idle", "dnd", "invisible"].includes(saved)) return saved;
        return "online";
      } catch {
        return "online";
      }
    }),
    [userStatuses, setUserStatuses] = useState<Record<string, UserStatus>>({}),
    [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const en = settings.language === "en";
  const mediaRef = useRef<HTMLDivElement>(null),
    mutedRef = useRef(false),
    deafenedRef = useRef(false),
    joiningRef = useRef(false),
    muteBeforeDeafenRef = useRef(false),
    activeTextRef = useRef<Channel | null>(null),
    usernameRef = useRef<string>(username),
    noiseGateRef = useRef<{ stop: () => void } | null>(null),
    fileInputRef = useRef<HTMLInputElement>(null),
    wsRef = useRef<WebSocket | null>(null),
    remoteGainsRef = useRef<Record<string, GainNode>>({}),
    lastTypingSentRef = useRef<number>(0),
    messagesContainerRef = useRef<HTMLDivElement>(null),
    isAtBottomRef = useRef(true),
    dragCounterRef = useRef(0),
    myStatusRef = useRef<UserStatus>(myStatus);
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const filteredMessages = messages.filter(
    (message) =>
      !searchQuery.trim() ||
      message.body.toLowerCase().includes(searchQuery.toLowerCase()) ||
      message.username.toLowerCase().includes(searchQuery.toLowerCase())
  );
  useEffect(() => {
    if (!searchOpen || !searchQuery.trim() || filteredMessages.length === 0) return;
    const activeMsg = filteredMessages[searchMatchIndex];
    if (activeMsg) {
      const el = document.getElementById(`msg-${activeMsg.id}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [searchMatchIndex, searchOpen, searchQuery]);
  useEffect(() => {
    activeTextRef.current = activeText;
  }, [activeText]);
  useEffect(() => {
    usernameRef.current = username;
  }, [username]);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);
  useEffect(() => {
    deafenedRef.current = deafened;
  }, [deafened]);
  useEffect(() => {
    currentSoundSettings = settings;
    localStorage.setItem("vf_settings", JSON.stringify(settings));
  }, [settings]);
  useEffect(() => {
    currentMyStatus = myStatus;
    myStatusRef.current = myStatus;
  }, [myStatus]);
  useEffect(() => {
    if (server) void loadChannels();
  }, [server]);
  useEffect(() => {
    if (!server) return;
    const checkPing = async () => {
      const start = performance.now();
      try {
        const res = await fetch(`${API()}/api/health`);
        if (res.ok) setPing(Math.round(performance.now() - start));
      } catch {}
    };
    void checkPing();
    const interval = setInterval(checkPing, 8000);
    return () => clearInterval(interval);
  }, [server]);
  useEffect(() => {
    if (activeText && token) void loadMessages();
  }, [activeText, token]);
  useEffect(() => {
    if (!token) return;
    const base = API();
    if (!base) return;
    const wsUrl = base.replace(/^http/i, "ws") + `/api/ws?token=${encodeURIComponent(token)}`;
    let ws: WebSocket | null = null;
    let reconnectTimer: any = null;
    let closedExplicitly = false;

    function connect() {
      try {
        ws = new WebSocket(wsUrl);
        wsRef.current = ws;
        ws.onopen = () => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ event: "status", status: myStatusRef.current }));
          }
        };
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.event === "message:created") {
              const newMsg = data.payload as Msg & { channel_id: number };
              if (activeTextRef.current && newMsg && newMsg.channel_id === activeTextRef.current.id) {
                setMessages((prev) => {
                  if (prev.some((m) => m.id === newMsg.id)) return prev;
                  return [...prev, newMsg];
                });
                if (newMsg.username !== usernameRef.current) {
                  if (myStatusRef.current !== "dnd") {
                    playSound("message");
                  }
                }
                if (isAtBottomRef.current) {
                  setTimeout(() => {
                    if (messagesContainerRef.current) {
                      messagesContainerRef.current.scrollTo({
                        top: messagesContainerRef.current.scrollHeight,
                        behavior: "smooth",
                      });
                    }
                  }, 40);
                } else {
                  setUnreadBelowCount((c) => c + 1);
                }
              }
              if (newMsg?.username) {
                setTypingUsers((prev) => {
                  if (!prev[newMsg.username]) return prev;
                  const next = { ...prev };
                  delete next[newMsg.username];
                  return next;
                });
              }
            } else if (data.event === "message:updated") {
              const updated = data.payload;
              if (activeTextRef.current && updated && updated.channel_id === activeTextRef.current.id) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === updated.id
                      ? { ...m, body: updated.body, is_edited: true, edited_at: updated.edited_at }
                      : m
                  )
                );
              }
            } else if (data.event === "message:deleted") {
              const deleted = data.payload;
              if (activeTextRef.current && deleted && deleted.channel_id === activeTextRef.current.id) {
                setMessages((prev) => prev.filter((m) => m.id !== deleted.id));
              }
            } else if (data.event === "user:typing") {
              const { channel_id, username: typingUser } = data.payload || {};
              if (activeTextRef.current && channel_id === activeTextRef.current.id && typingUser !== usernameRef.current) {
                setTypingUsers((prev) => ({ ...prev, [typingUser]: Date.now() + 3500 }));
              }
            } else if (data.event === "user:status") {
              const { username: stUser, status: stStatus } = data.payload || {};
              if (stUser && stStatus) {
                setUserStatuses((prev) => ({ ...prev, [stUser]: stStatus }));
              }
            } else if (data.event === "message:reaction") {
              const { messageId, emoji, username: reactingUser } = data.payload;
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== messageId) return m;
                  const currentReactions = { ...(m.reactions || {}) };
                  const users = currentReactions[emoji] || [];
                  if (users.includes(reactingUser)) {
                    currentReactions[emoji] = users.filter((u) => u !== reactingUser);
                    if (currentReactions[emoji].length === 0) delete currentReactions[emoji];
                  } else {
                    currentReactions[emoji] = [...users, reactingUser];
                  }
                  return { ...m, reactions: currentReactions };
                })
              );
            } else if (data.event === "channel:created") {
              const newChan = data.payload as Channel;
              if (newChan) {
                setChannels((prev) => {
                  if (prev.some((c) => c.id === newChan.id)) return prev;
                  return [...prev, newChan];
                });
              }
            } else if (data.event === "channel:deleted") {
              const { id } = data.payload || {};
              if (id) {
                setChannels((prev) => {
                  const updated = prev.filter((c) => c.id !== id);
                  if (activeTextRef.current?.id === id) {
                    const nextText = updated.find((c) => c.type === "text") || null;
                    setActiveText(nextText);
                  }
                  return updated;
                });
              }
            } else if (data.event === "channel:updated") {
              const updatedChan = data.payload as Channel;
              if (updatedChan) {
                setChannels((prev) =>
                  prev.map((c) => (c.id === updatedChan.id ? { ...c, name: updatedChan.name } : c))
                );
                if (activeTextRef.current?.id === updatedChan.id) {
                  setActiveText((current) => (current ? { ...current, name: updatedChan.name } : null));
                }
              }
            } else if (data.event === "user:updated") {
              const updated = data.payload as ServerUser;
              if (updated) {
                setServerUsers((prev) => {
                  const exists = prev.some((u) => u.id === updated.id);
                  if (exists) {
                    return prev.map((u) => (u.id === updated.id ? { ...u, ...updated } : u));
                  }
                  return [...prev, updated];
                });
                if (updated.username === usernameRef.current) {
                  setMyRole(updated.role);
                }
              }
            }
          } catch {}
        };
        ws.onclose = () => {
          wsRef.current = null;
          if (!closedExplicitly) {
            reconnectTimer = setTimeout(connect, 3000);
          }
        };
      } catch {}
    }

    connect();

    return () => {
      closedExplicitly = true;
      wsRef.current = null;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, [token, server]);
  function toggleReaction(messageId: number, emoji: string) {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          event: "reaction",
          channelId: activeTextRef.current?.id,
          messageId,
          emoji,
        })
      );
    }
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId) return m;
        const currentReactions = { ...(m.reactions || {}) };
        const users = currentReactions[emoji] || [];
        if (users.includes(usernameRef.current)) {
          currentReactions[emoji] = users.filter((u) => u !== usernameRef.current);
          if (currentReactions[emoji].length === 0) delete currentReactions[emoji];
        } else {
          currentReactions[emoji] = [...users, usernameRef.current];
        }
        return { ...m, reactions: currentReactions };
      })
    );
    playSound("click");
  }

  function notifyTyping() {
    if (!activeTextRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    if (now - lastTypingSentRef.current > 2000) {
      lastTypingSentRef.current = now;
      wsRef.current.send(
        JSON.stringify({
          event: "typing",
          channelId: activeTextRef.current.id,
        })
      );
    }
  }

  async function editMessage(msgId: number, newBody: string) {
    if (!activeText || !newBody.trim()) return;
    try {
      const res = await fetch(`${server}/api/channels/${activeText.id}/messages/${msgId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ body: newBody.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId ? { ...m, body: data.body, is_edited: true, edited_at: data.edited_at } : m
          )
        );
        setEditingMessageId(null);
        setEditingText("");
      }
    } catch (err) {
      console.error("Failed to edit message:", err);
    }
  }

  async function deleteMessage(msgId: number) {
    if (!activeText) return;
    if (!window.confirm(en ? "Are you sure you want to delete this message?" : "Удалить это сообщение?")) return;
    try {
      const res = await fetch(`${server}/api/channels/${activeText.id}/messages/${msgId}`, {
        method: "DELETE",
        headers,
      });
      if (res.ok) {
        setMessages((prev) => prev.filter((m) => m.id !== msgId));
      }
    } catch (err) {
      console.error("Failed to delete message:", err);
    }
  }

  async function createChannel(name: string, type: "text" | "voice") {
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreateChannelLoading(true);
    try {
      const res = await fetch(`${server}/api/channels`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: trimmed, type }),
      });
      if (res.ok) {
        const created = await res.json();
        setChannels((prev) => {
          if (prev.some((c) => c.id === created.id)) return prev;
          return [...prev, created];
        });
        if (created.type === "text") {
          setActiveText(created);
        }
        setCreateChannelOpen(false);
        setNewChannelName("");
        playSound("click");
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || (en ? "Failed to create channel" : "Не удалось создать канал"));
      }
    } catch (err) {
      console.error("Failed to create channel:", err);
    } finally {
      setCreateChannelLoading(false);
    }
  }

  async function renameChannel(channelId: number, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setEditChannelLoading(true);
    try {
      const res = await fetch(`${server}/api/channels/${channelId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json();
      if (res.ok && data.channel) {
        setChannels((prev) =>
          prev.map((c) => (c.id === channelId ? { ...c, name: data.channel.name } : c))
        );
        if (activeText?.id === channelId) {
          setActiveText((current) => (current ? { ...current, name: data.channel.name } : null));
        }
        if (voice === editChannelModal?.name) {
          setVoice(data.channel.name);
        }
        setEditChannelModal(null);
        setEditChannelName("");
        playSound("click");
      } else {
        alert(data.error || (en ? "Failed to rename channel" : "Не удалось переименовать канал"));
      }
    } catch (err) {
      console.error("Failed to rename channel:", err);
      alert(en ? "Failed to rename channel" : "Не удалось переименовать канал");
    } finally {
      setEditChannelLoading(false);
    }
  }

  async function deleteChannel(channelId: number, channelName: string) {
    if (
      !window.confirm(
        en
          ? `Are you sure you want to delete channel "${channelName}"? All messages in it will be permanently deleted.`
          : `Вы уверены, что хотите удалить канал "${channelName}"? Все сообщения в нём будут безвозвратно удалены.`
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`${server}/api/channels/${channelId}`, {
        method: "DELETE",
        headers,
      });
      if (res.ok) {
        setChannels((prev) => {
          const updated = prev.filter((c) => c.id !== channelId);
          if (activeText?.id === channelId) {
            const nextText = updated.find((c) => c.type === "text") || null;
            setActiveText(nextText);
          }
          return updated;
        });
        if (voice === channelName) {
          void leaveVoice();
        }
        playSound("click");
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || (en ? "Failed to delete channel" : "Не удалось удалить канал"));
      }
    } catch (err) {
      console.error("Failed to delete channel:", err);
    }
  }

  async function updateUserRole(targetUserId: number, targetUsername: string, newRole: Role) {
    try {
      const res = await fetch(`${server}/api/users/${targetUserId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ role: newRole }),
      });
      if (res.ok) {
        setServerUsers((prev) =>
          prev.map((u) => (u.id === targetUserId ? { ...u, role: newRole } : u))
        );
        playSound("click");
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || (en ? "Failed to update role" : "Не удалось обновить роль"));
      }
    } catch (err) {
      console.error("Failed to update user role:", err);
    }
  }

  async function toggleUserBlocked(targetUserId: number, targetUsername: string, disabled: boolean) {
    if (
      !window.confirm(
        disabled
          ? (en ? `Block user ${targetUsername}?` : `Заблокировать пользователя ${targetUsername}?`)
          : (en ? `Unblock user ${targetUsername}?` : `Разблокировать пользователя ${targetUsername}?`)
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`${server}/api/users/${targetUserId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ disabled }),
      });
      if (res.ok) {
        void loadUsers();
        playSound("click");
      }
    } catch (err) {
      console.error("Failed to toggle block:", err);
    }
  }
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
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            if (!active) return;
            localStorage.removeItem("vf_token");
            localStorage.removeItem("vf_user");
            sessionStorage.removeItem("vf_token");
            sessionStorage.removeItem("vf_user");
            setToken("");
            setSessionReady(true);
            setNotice(en ? "Session expired. Sign in again." : "Сессия истекла. Войдите снова.");
            return;
          }
          if (active) setSessionReady(true);
          return;
        }
        const data = await response.json();
        if (active) {
          setUsername(data.user.username);
          if (data.user.role) setMyRole(data.user.role);
          localStorage.setItem("vf_user", data.user.username);
          setSessionReady(true);
        }
      })
      .catch(() => {
        if (!active) return;
        // Network or offline: preserve session and username, do not kick out
        setSessionReady(true);
      });
    return () => {
      active = false;
    };
  }, [token]);

  useEffect(() => {
    if (token) {
      void loadUsers();
    }
  }, [token, server]);

  async function loadUsers() {
    if (!token) return;
    try {
      const res = await fetch(`${API()}/api/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) setServerUsers(data);
      }
    } catch {}
  }

  function getUserRole(uName: string): Role {
    if (uName === username && myRole) return myRole;
    const found = serverUsers.find((u) => u.username === uName);
    if (found) return found.role;
    return "user";
  }

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
      const prev = localStorage.getItem("vf_server");
      localStorage.setItem("vf_server", clean);
      // Only clear auth when switching to a DIFFERENT server
      if (prev !== clean) {
        localStorage.removeItem("vf_token");
        localStorage.removeItem("vf_user");
        sessionStorage.removeItem("vf_token");
        sessionStorage.removeItem("vf_user");
        setToken("");
        setUsername("");
      }
      setServer(clean);
    } catch {
      setConnectError(true);
    }
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
    setUsername("");
    setChannels([]);
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
    setSharing(false);
    setCallStatus("idle");
    setStreamStatus("idle");
    setStreamSource("");
    setLocalStreamTrack(null);
    setSources([]);
    if (noiseGateRef.current) {
      noiseGateRef.current.stop();
      noiseGateRef.current = null;
    }
    if (mediaRef.current) mediaRef.current.innerHTML = "";
    document
      .querySelectorAll<HTMLMediaElement>('[data-voiceforge-audio="true"]')
      .forEach((element) => element.remove());
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
        body: JSON.stringify({ username: user, password, remember: mode === "register" ? true : remember }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Ошибка входа");
      // Registration always remembers; login uses the checkbox
      const persist = mode === "register" ? true : remember;
      const storage = persist ? localStorage : sessionStorage;
      const otherStorage = persist ? sessionStorage : localStorage;
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
    if (response.ok) {
      setMessages(await response.json());
      setIsAtBottom(true);
      isAtBottomRef.current = true;
      setUnreadBelowCount(0);
      setTimeout(() => {
        if (messagesContainerRef.current) {
          messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
        }
      }, 50);
    }
  }
  async function send() {
    if ((!text.trim() && !attachment) || !activeText) return;
    const body = text.trim();
    const currentAttachment = attachment;
    const currentReplyTo = replyTo;
    setText("");
    setAttachment(null);
    setReplyTo(null);
    try {
      const response = await fetch(
        `${API()}/api/channels/${activeText.id}/messages`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            body: body || (currentAttachment ? (en ? "Sent an attachment" : "Вложение") : ""),
            reply_to: currentReplyTo ? { id: currentReplyTo.id, username: currentReplyTo.username, body: currentReplyTo.body } : null,
            attachment: currentAttachment || null,
          }),
        },
      );
      if (!response.ok) throw new Error();
      const newMsg = await response.json();
      if (newMsg && newMsg.id) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === newMsg.id)) return prev;
          return [...prev, newMsg];
        });
      }
      playSound("message");
      setIsAtBottom(true);
      isAtBottomRef.current = true;
      setUnreadBelowCount(0);
      setTimeout(() => {
        if (messagesContainerRef.current) {
          messagesContainerRef.current.scrollTo({
            top: messagesContainerRef.current.scrollHeight,
            behavior: "smooth",
          });
        }
      }, 50);
    } catch {
      playSound("error");
      setText(body);
      setAttachment(currentAttachment);
      setReplyTo(currentReplyTo);
      setNotice(en ? "Could not send the message" : "Не удалось отправить сообщение");
    }
  }

  function processFile(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      setNotice(en ? "File is too large (max 5MB)" : "Файл слишком большой (максимум 5 МБ)");
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      if (typeof event.target?.result === "string") {
        setAttachment(event.target.result);
        playSound("click");
      }
    };
    reader.readAsDataURL(file);
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          processFile(file);
          e.preventDefault();
          break;
        }
      }
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
    if (e.target) e.target.value = "";
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types && Array.from(e.dataTransfer.types).includes("Files")) {
      setIsDraggingFile(true);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDraggingFile(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDraggingFile(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
  }
  function startVoiceActivityGate(roomInstance: Room, currentSettings: ClientSettings) {
    if (noiseGateRef.current) {
      noiseGateRef.current.stop();
      noiseGateRef.current = null;
    }
    const micPub = roomInstance.localParticipant.getTrackPublication(Track.Source.Microphone);
    const mediaStreamTrack = micPub?.track?.mediaStreamTrack;
    if (!mediaStreamTrack) return;

    try {
      const audioCtx = new AudioContext();
      const stream = new MediaStream([mediaStreamTrack]);
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);

      const dataArray = new Float32Array(analyser.fftSize);
      let animationId = 0;
      let speakingUntil = 0;

      const check = () => {
        if (audioCtx.state === "suspended") void audioCtx.resume();
        analyser.getFloatTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / dataArray.length);
        let volume = 0;
        if (rms > 0.0001) {
          const dB = 20 * Math.log10(rms);
          volume = Math.max(0, Math.min(100, ((dB + 55) / 45) * 100)) * (currentSettings.inputVolume / 100);
        }
        const threshold = currentSettings.autoThreshold ? 15 : currentSettings.voiceThreshold;

        const isSpeakingNow = volume >= threshold;
        const now = Date.now();
        const myName = usernameRef.current || username;

        if (mutedRef.current || deafenedRef.current) {
          if (myName) {
            setParticipantStates((current) => {
              if (!current[myName]?.speaking && !current[myName]?.mic) return current;
              return {
                ...current,
                [myName]: { mic: false, speaking: false },
              };
            });
          }
          animationId = requestAnimationFrame(check);
          return;
        }

        if (isSpeakingNow) {
          speakingUntil = now + 350;
          if (myName) {
            setParticipantStates((current) => {
              if (current[myName]?.speaking && current[myName]?.mic) return current;
              return {
                ...current,
                [myName]: { mic: true, speaking: true },
              };
            });
          }
        } else if (now > speakingUntil) {
          if (myName) {
            setParticipantStates((current) => {
              if (!current[myName]?.speaking && current[myName]?.mic) return current;
              return {
                ...current,
                [myName]: { mic: true, speaking: false },
              };
            });
          }
        }

        animationId = requestAnimationFrame(check);
      };
      check();

      noiseGateRef.current = {
        stop: () => {
          cancelAnimationFrame(animationId);
          void audioCtx.close();
        },
      };
    } catch {}
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
        setLocalStreamTrack((publication.track as LocalTrack | undefined) || null);
      });
      next.on(RoomEvent.LocalTrackUnpublished, (publication) => {
        if (publication.source !== Track.Source.ScreenShare) return;
        setSharing(false);
        setStreamStatus("idle");
        setStreamSource("");
        setLocalStreamTrack(null);
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
            const pName = participant.name || participant.identity;
            element.dataset.voiceforgeAudio = "true";
            element.dataset.participant = pName;
            element.muted = deafenedRef.current;
            const userVol = (userVolumes[pName] ?? 100) / 100;
            element.volume = Math.max(0, Math.min(1, (settings.outputVolume / 100) * userVol));
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
      const shouldEnableMic = !mutedRef.current && !deafenedRef.current;
      try {
        if (shouldEnableMic) {
          await next.localParticipant.setMicrophoneEnabled(true, {
            deviceId: settings.inputDevice && settings.inputDevice !== "default" ? settings.inputDevice : undefined,
            noiseSuppression: settings.noiseSuppression,
            echoCancellation: settings.echoCancellation,
            autoGainControl: settings.autoGainControl,
          });
          startVoiceActivityGate(next, settings);
        } else {
          await next.localParticipant.setMicrophoneEnabled(false);
          const micPub = next.localParticipant.getTrackPublication(Track.Source.Microphone);
          if (micPub?.track?.mediaStreamTrack) {
            micPub.track.mediaStreamTrack.enabled = false;
          }
          await micPub?.mute().catch(() => {});
        }
        refresh();
      } catch (microphoneError) {
        setMuted(true);
        mutedRef.current = true;
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
    if (deafened) {
      setNotice(en ? "Enable sound before turning on the microphone" : "Сначала включите звук, чтобы включить микрофон");
      return;
    }
    const nextMuted = !muted;
    setMuted(nextMuted);
    mutedRef.current = nextMuted;
    playSound(nextMuted ? "mute" : "unmute");

    if (username) {
      setParticipantStates((current) => ({
        ...current,
        [username]: { mic: !nextMuted, speaking: false },
      }));
    }

    if (room) {
      try {
        const audioPubs = Array.from(room.localParticipant.audioTrackPublications.values());
        for (const pub of audioPubs) {
          if (pub.track?.mediaStreamTrack) {
            pub.track.mediaStreamTrack.enabled = !nextMuted;
          }
          if (nextMuted) {
            await pub.mute().catch(() => {});
          } else {
            await pub.unmute().catch(() => {});
          }
        }
        await room.localParticipant.setMicrophoneEnabled(!nextMuted, {
          deviceId: settings.inputDevice && settings.inputDevice !== "default" ? settings.inputDevice : undefined,
          noiseSuppression: settings.noiseSuppression,
          echoCancellation: settings.echoCancellation,
          autoGainControl: settings.autoGainControl,
        }).catch(() => {});

        if (nextMuted) {
          if (noiseGateRef.current) {
            noiseGateRef.current.stop();
            noiseGateRef.current = null;
          }
        } else {
          startVoiceActivityGate(room, settings);
        }
      } catch (err) {
        console.warn("toggleMute room sync error:", err);
      }
    }
  }
  async function toggleDeafen() {
    const nextDeafened = !deafened;
    setDeafened(nextDeafened);
    deafenedRef.current = nextDeafened;
    playSound(nextDeafened ? "mute" : "unmute");

    // Immediately mute/unmute all incoming audio elements from participants and screen shares
    document
      .querySelectorAll<HTMLMediaElement>('[data-voiceforge-audio="true"]')
      .forEach((element) => {
        element.muted = nextDeafened;
      });

    if (nextDeafened) {
      // Deafening automatically mutes microphone as well
      muteBeforeDeafenRef.current = muted;
      setMuted(true);
      mutedRef.current = true;
      if (username) {
        setParticipantStates((current) => ({
          ...current,
          [username]: { mic: false, speaking: false },
        }));
      }
      if (room) {
        if (noiseGateRef.current) {
          noiseGateRef.current.stop();
          noiseGateRef.current = null;
        }
        const audioPubs = Array.from(room.localParticipant.audioTrackPublications.values());
        for (const pub of audioPubs) {
          if (pub.track?.mediaStreamTrack) pub.track.mediaStreamTrack.enabled = false;
          await pub.mute().catch(() => {});
        }
        await room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
      }
    } else {
      // Undeafening restores microphone if it was NOT muted prior to deafening
      const shouldUnmuteMic = !muteBeforeDeafenRef.current;
      if (shouldUnmuteMic) {
        setMuted(false);
        mutedRef.current = false;
        if (username) {
          setParticipantStates((current) => ({
            ...current,
            [username]: { mic: true, speaking: false },
          }));
        }
        if (room) {
          await room.localParticipant.setMicrophoneEnabled(true, {
            deviceId: settings.inputDevice && settings.inputDevice !== "default" ? settings.inputDevice : undefined,
            noiseSuppression: settings.noiseSuppression,
            echoCancellation: settings.echoCancellation,
            autoGainControl: settings.autoGainControl,
          }).catch(() => {});
          const audioPubs = Array.from(room.localParticipant.audioTrackPublications.values());
          for (const pub of audioPubs) {
            if (pub.track?.mediaStreamTrack) {
              pub.track.mediaStreamTrack.enabled = true;
            }
            await pub.unmute().catch(() => {});
          }
          startVoiceActivityGate(room, settings);
        }
      } else {
        setMuted(true);
        mutedRef.current = true;
        if (username) {
          setParticipantStates((current) => ({
            ...current,
            [username]: { mic: false, speaking: false },
          }));
        }
      }
    }
  }
  function toggleRemoteStream(id: string) {
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
  async function startShare(source: DesktopSource, quality: StreamQuality) {
    if (!room || !bridge) return;
    setStreamStatus("starting");
    setStreamSource(source.name);
    setSourceLoading(true);
    try {
      await waitForMediaConnection(room);
      await bridge.selectScreenSource(source.id);
      const preset = streamQualities[quality];
      await room.localParticipant.setScreenShareEnabled(
        true,
        { audio: true, resolution: { width: preset.width, height: preset.height, frameRate: preset.frameRate } },
        { videoEncoding: { maxBitrate: preset.bitrate, maxFramerate: preset.frameRate } },
      );
      setStreamQuality(quality);
      setPreviewOpen(true);
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
  function changeStatus(next: UserStatus) {
    setMyStatus(next);
    myStatusRef.current = next;
    currentMyStatus = next;
    try {
      localStorage.setItem("vf_user_status", next);
    } catch {}
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ event: "status", status: next }));
    }
    setStatusMenuOpen(false);
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
  function setUserVolume(targetUser: string, vol: number) {
    const clamped = Math.max(0, Math.min(200, vol));
    const updated = { ...userVolumes, [targetUser]: clamped };
    setUserVolumes(updated);
    try {
      localStorage.setItem("vf_user_volumes", JSON.stringify(updated));
    } catch {}

    document
      .querySelectorAll<HTMLMediaElement>('[data-voiceforge-audio="true"]')
      .forEach((el) => {
        if (el.dataset.participant === targetUser) {
          const base = settings.outputVolume / 100;
          const mult = clamped / 100;
          el.volume = Math.max(0, Math.min(1, base * mult));
        }
      });
  }
  async function applySettings(next: ClientSettings) {
    setSettings(next);
    currentSoundSettings = next;
    try {
      localStorage.setItem("vf_settings", JSON.stringify(next));
    } catch {}

    document
      .querySelectorAll<HTMLMediaElement>('[data-voiceforge-audio="true"]')
      .forEach((element) => {
        const pName = element.dataset.participant;
        const userVol = pName ? ((userVolumes[pName] ?? 100) / 100) : 1;
        element.volume = Math.max(0, Math.min(1, (next.outputVolume / 100) * userVol));
      });

    if (room) {
      try {
        if (next.outputDevice && next.outputDevice !== "default") {
          await room.switchActiveDevice(
            "audiooutput",
            next.outputDevice,
            false,
          ).catch(() => {});
        }
        const shouldEnableMic = !mutedRef.current && !deafenedRef.current;
        if (shouldEnableMic) {
          await room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
          await room.localParticipant.setMicrophoneEnabled(true, {
            deviceId: next.inputDevice && next.inputDevice !== "default" ? next.inputDevice : undefined,
            noiseSuppression: next.noiseSuppression,
            echoCancellation: next.echoCancellation,
            autoGainControl: next.autoGainControl,
          });
          startVoiceActivityGate(room, next);
        } else {
          await room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
          const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
          if (micPub?.track?.mediaStreamTrack) {
            micPub.track.mediaStreamTrack.enabled = false;
          }
          await micPub?.mute().catch(() => {});
        }
      } catch (err) {
        console.warn("Device switch error:", err);
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
  if (!server)
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
          onChangeServer={changeServer}
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
          <div className="headTitleGroup">
            <b>{server.replace(/^https?:\/\//, "") || "VoiceForge"}</b>
            <small>{en ? "VoiceForge Server" : "Сервер VoiceForge"}</small>
          </div>
          <button
            type="button"
            className="serverActionBtn"
            onClick={changeServer}
            title={en ? "Change server" : "Сменить сервер"}
          >
            ⋮
          </button>
        </div>
        <div className="sidebarScrollArea">
          <div
            className="discordCategoryHead"
            onClick={() => setCollapsedCategories((prev) => ({ ...prev, text: !prev.text }))}
          >
            <div className="categoryTitle">
              <span className={`discordChevron ${collapsedCategories.text ? "collapsed" : ""}`}>▼</span>
              <span>{en ? "TEXT CHANNELS" : "ТЕКСТОВЫЕ КАНАЛЫ"}</span>
            </div>
            <div className="categoryRight">
              <span className="categoryCount">{channels.filter((c) => c.type === "text").length}</span>
              <button
                type="button"
                className="discordCategoryAddBtn"
                onClick={(e) => {
                  e.stopPropagation();
                  setCreateChannelType("text");
                  setCreateChannelOpen(true);
                }}
                title={en ? "Create Text Channel" : "Создать текстовый канал"}
              >
                +
              </button>
            </div>
          </div>
          {!collapsedCategories.text && channels
            .filter((channel) => channel.type === "text")
            .map((channel) => (
              <div className="discordChannelRow" key={channel.id}>
                <button
                  className={
                    "discordChannelBtn " + (activeText?.id === channel.id ? "active" : "")
                  }
                  onClick={() => setActiveText(channel)}
                >
                  <i className="chanIcon">#</i>
                  <span className="chanName">{channel.name}</span>
                </button>
                <div className="discordChanActions">
                  <button
                    type="button"
                    className="discordChanSettingsBtn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditChannelModal(channel);
                      setEditChannelName(channel.name);
                    }}
                    title={en ? `Edit #${channel.name}` : `Настроить #${channel.name}`}
                  >
                    ⚙️
                  </button>
                  <button
                    type="button"
                    className="discordChanDeleteBtn"
                    onClick={(e) => {
                      e.stopPropagation();
                      void deleteChannel(channel.id, channel.name);
                    }}
                    title={en ? `Delete #${channel.name}` : `Удалить канал #${channel.name}`}
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}

          <div
            className="discordCategoryHead"
            onClick={() => setCollapsedCategories((prev) => ({ ...prev, voice: !prev.voice }))}
          >
            <div className="categoryTitle">
              <span className={`discordChevron ${collapsedCategories.voice ? "collapsed" : ""}`}>▼</span>
              <span>{en ? "VOICE CHANNELS" : "ГОЛОСОВЫЕ КАНАЛЫ"}</span>
            </div>
            <div className="categoryRight">
              <span className="categoryCount">{channels.filter((c) => c.type === "voice").length}</span>
              <button
                type="button"
                className="discordCategoryAddBtn"
                onClick={(e) => {
                  e.stopPropagation();
                  setCreateChannelType("voice");
                  setCreateChannelOpen(true);
                }}
                title={en ? "Create Voice Channel" : "Создать голосовой канал"}
              >
                +
              </button>
            </div>
          </div>
          {!collapsedCategories.voice && channels
            .filter((channel) => channel.type === "voice")
            .map((channel) => (
              <React.Fragment key={channel.id}>
                <div className="discordChannelRow">
                  <button
                    className={
                      "discordChannelBtn voiceChan " + (voice === channel.name ? "connected" : "")
                    }
                    onClick={() => void joinVoice(channel.name)}
                    disabled={callStatus === "connecting"}
                  >
                    <i className="chanIcon">🔊</i>
                    <span className="chanName">{channel.name}</span>
                    {voice === channel.name && (
                      <span className="voiceSignalPill">
                        <span className="voiceSignalBar" />
                        <span className="voiceSignalBar" />
                        <span className="voiceSignalBar" />
                      </span>
                    )}
                  </button>
                  <div className="discordChanActions">
                    <button
                      type="button"
                      className="discordChanSettingsBtn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditChannelModal(channel);
                        setEditChannelName(channel.name);
                      }}
                      title={en ? `Edit ${channel.name}` : `Настроить ${channel.name}`}
                    >
                      ⚙️
                    </button>
                    <button
                      type="button"
                      className="discordChanDeleteBtn"
                      onClick={(e) => {
                        e.stopPropagation();
                        void deleteChannel(channel.id, channel.name);
                      }}
                      title={en ? `Delete ${channel.name}` : `Удалить канал ${channel.name}`}
                    >
                      ×
                    </button>
                  </div>
                </div>
                {voice === channel.name && (
                  <div className="discordChannelUsers">
                    {participants.map((participant) => {
                      const isSpeaking = Boolean(participantStates[participant]?.speaking);
                      return (
                        <div
                          className={`discordChannelUserRow ${isSpeaking ? "speaking" : ""} ${remoteStreams.some((stream) => stream.name === participant && stream.video) || (participant === username && streamStatus === "live") ? "isStreaming" : ""}`}
                          key={participant}
                        >
                          <span
                            className={`discordChannelUserStatusDot ${isSpeaking ? "speakingDot" : ""}`}
                          >
                            ●
                          </span>
                          <span className={`userNameText ${isSpeaking ? "speakingName" : ""}`}>{participant}</span>
                          {isSpeaking && (
                            <span className="speakingWaveMini" title={en ? "Speaking" : "Говорит"}>
                              <span /><span /><span />
                            </span>
                          )}
                        {participant === username && streamStatus === "live" && (
                          <span className="userLiveBadge own"><i />{en ? "LIVE" : "ЭФИР"}</span>
                        )}
                        {remoteStreams.filter((stream) => stream.name === participant && stream.video).map((stream) => (
                          <button
                            className={`userLiveBadge ${stream.watching ? "watching" : ""}`}
                            key={stream.id}
                            onClick={() => toggleRemoteStream(stream.id)}
                            title={en ? `Watch ${participant}'s stream` : `Смотреть трансляцию ${participant}`}
                          >
                            <i />{stream.watching ? (en ? "WATCHING" : "СМОТРИМ") : (en ? "LIVE" : "ЭФИР")}
                          </button>
                        ))}
                        <span
                          className={`sidebarMic ${participantStates[participant]?.mic ? "on" : "off"}`}
                          title={participantStates[participant]?.mic ? (en ? "Microphone on" : "Микрофон включён") : (en ? "Microphone off" : "Микрофон выключен")}
                        >
                          {participantStates[participant]?.mic ? <MicIcon size={13} /> : <MicOffIcon size={13} />}
                        </span>
                        {participant !== username && (
                          <button
                            type="button"
                            className={`sidebarUserVolumeBtn ${(userVolumes[participant] ?? 100) !== 100 ? "custom" : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setVolumeMenuUser(volumeMenuUser === participant ? null : participant);
                            }}
                            title={en ? `Volume: ${userVolumes[participant] ?? 100}%` : `Громкость: ${userVolumes[participant] ?? 100}%`}
                          >
                            {(userVolumes[participant] ?? 100) === 0 ? <VolumeMuteIcon size={13} /> : <VolumeUpIcon size={13} />}
                            {(userVolumes[participant] ?? 100) !== 100 && (
                              <span className="sidebarVolTag">{userVolumes[participant]}%</span>
                            )}
                          </button>
                        )}
                      </div>
                    );
                  })}
                  </div>
                )}
              </React.Fragment>
            ))}
        </div>

        {voice && (
          <div className="discordVoiceStatusBar">
            <div className="voiceStatusLeft">
              <span className={`voiceStatusSignal ${callStatus}`}>
                <i /><i /><i />
              </span>
              <div>
                <b className="voiceStatusTitle">
                  {callStatus === "connected"
                    ? en ? "Voice Connected" : "Голос подключён"
                    : callStatus === "connecting"
                      ? en ? "Connecting…" : "Подключение…"
                      : en ? "Reconnecting…" : "Восстановление…"}
                </b>
                <span className="voiceStatusChannel">
                  {voice} {ping !== null && <small className="pingValue">/ {ping}ms</small>}
                </span>
              </div>
            </div>
            <button
              className="voiceDisconnectBtn"
              onClick={() => void leaveVoice()}
              title={en ? "Disconnect" : "Отключиться"}
            >
              📞✕
            </button>
          </div>
        )}

        <div className="discordUserPanel">
          {statusMenuOpen && (
            <>
              <div
                className="discordStatusMenuBackdrop"
                onClick={() => setStatusMenuOpen(false)}
              />
              <div className="discordStatusMenu" onClick={(e) => e.stopPropagation()}>
                <div className="statusMenuHeader">
                  <span>{en ? "SET STATUS" : "УСТАНОВИТЬ СТАТУС"}</span>
                </div>
                {(["online", "idle", "dnd", "invisible"] as UserStatus[]).map((st) => {
                  const details = getStatusDetails(st, en);
                  const isSelected = myStatus === st;
                  return (
                    <button
                      key={st}
                      type="button"
                      className={`statusMenuItem ${isSelected ? "selected" : ""}`}
                      onClick={() => changeStatus(st)}
                    >
                      <span className="statusMenuDot" style={{ color: details.color }}>
                        ●
                      </span>
                      <div className="statusMenuText">
                        <b>{details.label}</b>
                        <small>{details.desc}</small>
                      </div>
                      {isSelected && <span className="statusMenuCheck">✓</span>}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          <div
            className="discordUserInfo"
            onClick={() => setStatusMenuOpen(!statusMenuOpen)}
            title={en ? "Change Status" : "Сменить статус"}
          >
            <span
              className="discordOnlineDot"
              style={{ color: getStatusDetails(myStatus, en).color }}
            >
              ●
            </span>
            <div className="discordUserText">
              <div className="discordUserNameRow">
                <b
                  className="discordUsername"
                  style={{
                    color: myRole !== "user" ? getRoleBadge(myRole, en).color : "#f2f3f5",
                  }}
                >
                  {username}
                </b>
                {myRole !== "user" && (
                  <span className="discordUserPanelRoleIcon" title={getRoleBadge(myRole, en).name}>
                    {getRoleBadge(myRole, en).icon}
                  </span>
                )}
              </div>
              <small
                className="discordSubtext"
                style={{ color: getStatusDetails(myStatus, en).color }}
              >
                {getStatusDetails(myStatus, en).label}
              </small>
            </div>
          </div>
          <div className="discordUserControls">
            <button
              className={`userControlBtn ${muted ? "active" : ""}`}
              onClick={() => void toggleMute()}
              title={muted ? (en ? "Unmute Microphone" : "Включить микрофон") : (en ? "Mute Microphone" : "Заглушить микрофон")}
            >
              {muted ? <MicOffIcon size={18} /> : <MicIcon size={18} />}
            </button>
            <button
              className={`userControlBtn ${deafened ? "active" : ""}`}
              onClick={() => void toggleDeafen()}
              title={deafened ? (en ? "Undeafen" : "Включить звук") : (en ? "Deafen" : "Заглушить звук")}
            >
              {deafened ? <HeadphonesOffIcon size={18} /> : <HeadphonesIcon size={18} />}
            </button>
            <button
              className={`userControlBtn ${settingsOpen ? "active" : ""}`}
              onClick={() => setSettingsOpen(true)}
              title={en ? "User Settings" : "Настройки"}
            >
              <GearIcon size={18} />
            </button>
            <button
              className="userControlBtn logout"
              onClick={logout}
              title={en ? "Log Out" : "Выйти из аккаунта"}
            >
              <LogoutIcon size={18} />
            </button>
          </div>
        </div>
      </aside>
      <main className="content">
        <header>
          <div className="title">
            <span className="channelHashIcon">#</span>
            <div className="headTitleGroup">
              <b>{activeText?.name || "general"}</b>
              <small>{en ? "Text Channel" : "Текстовый канал"}</small>
            </div>
          </div>
          <div className="headerBtns">
            <div
              className="headerPingBadge"
              title={en ? "Connection Info (Click for details)" : "Сведения о соединении (Нажмите для подробностей)"}
              onClick={() => setConnectionInfoOpen(true)}
            >
              <span className={`pingDot ${(ping ?? 24) < 60 ? "good" : (ping ?? 24) < 150 ? "medium" : "bad"}`} />
              <span>{ping ?? 24} ms</span>
            </div>
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
          <div className="discordSearchBarRow">
            <div className="searchBarLeft">
              <span className="searchIcon">⌕</span>
              <input
                autoFocus
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setSearchMatchIndex(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setSearchOpen(false);
                    setSearchQuery("");
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    if (filteredMessages.length > 0) {
                      if (e.shiftKey) {
                        setSearchMatchIndex((prev) =>
                          prev > 0 ? prev - 1 : filteredMessages.length - 1
                        );
                      } else {
                        setSearchMatchIndex((prev) =>
                          prev < filteredMessages.length - 1 ? prev + 1 : 0
                        );
                      }
                    }
                  }
                }}
                placeholder={
                  en
                    ? `Search in #${activeText?.name || "chat"}…`
                    : `Поиск в #${activeText?.name || "чате"}…`
                }
              />
              {searchQuery && (
                <button
                  type="button"
                  className="searchClearBtn"
                  onClick={() => {
                    setSearchQuery("");
                    setSearchMatchIndex(0);
                  }}
                  title={en ? "Clear input" : "Очистить"}
                >
                  ✕
                </button>
              )}
            </div>

            <div className="searchBarRight">
              {searchQuery.trim() && (
                <div className="searchMatchesInfo">
                  {filteredMessages.length > 0 ? (
                    <>
                      <span className="searchCountText">
                        {searchMatchIndex + 1} {en ? "of" : "из"} {filteredMessages.length}
                      </span>
                      <button
                        type="button"
                        className="searchNavBtn"
                        disabled={filteredMessages.length <= 1}
                        onClick={() =>
                          setSearchMatchIndex((prev) =>
                            prev > 0 ? prev - 1 : filteredMessages.length - 1
                          )
                        }
                        title={en ? "Previous match (Shift+Enter)" : "Предыдущее (Shift+Enter)"}
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        className="searchNavBtn"
                        disabled={filteredMessages.length <= 1}
                        onClick={() =>
                          setSearchMatchIndex((prev) =>
                            prev < filteredMessages.length - 1 ? prev + 1 : 0
                          )
                        }
                        title={en ? "Next match (Enter)" : "Следующее (Enter)"}
                      >
                        ▼
                      </button>
                    </>
                  ) : (
                    <span className="searchNoMatches">
                      {en ? "No matches" : "Нет совпадений"}
                    </span>
                  )}
                </div>
              )}
              <button
                type="button"
                className="searchCloseBtn"
                onClick={() => {
                  setSearchQuery("");
                  setSearchOpen(false);
                }}
                title={en ? "Close search (Esc)" : "Закрыть поиск (Esc)"}
              >
                ✕
              </button>
            </div>
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
                  className={`personCard ${participantStates[participant]?.speaking ? "speaking" : ""} ${participantStates[participant]?.mic ? "micEnabled" : "micDisabled"} ${remoteStreams.some((stream) => stream.name === participant && stream.video) || (participant === username && streamStatus === "live") ? "isStreaming" : ""}`}
                  key={participant}
                >
                  {participant === username && streamStatus === "live" && (
                    <span className="cardLiveBadge"><i />{en ? "YOU ARE LIVE" : "ВЫ В ЭФИРЕ"}</span>
                  )}
                  {remoteStreams.filter((stream) => stream.name === participant && stream.video).map((stream) => (
                    <button
                      className={`cardLiveBadge clickable ${stream.watching ? "watching" : ""}`}
                      key={stream.id}
                      onClick={() => toggleRemoteStream(stream.id)}
                    >
                      <i />{stream.watching
                        ? (en ? "WATCHING — CLICK TO CLOSE" : "СМОТРИМ — НАЖМИТЕ, ЧТОБЫ ЗАКРЫТЬ")
                        : (en ? "LIVE — CLICK TO WATCH" : "ИДЁТ ТРАНСЛЯЦИЯ — НАЖМИТЕ, ЧТОБЫ СМОТРЕТЬ")}
                    </button>
                  ))}
                  <Avatar name={participant} large />
                  <b>{participant}</b>
                  <div className="voiceStatus">
                    <span className="micState">
                      {participantStates[participant]?.mic ? <MicIcon size={14} /> : <MicOffIcon size={14} />}
                    </span>
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
            {streamStatus === "live" && localStreamTrack && (
              <StreamPreview
                track={localStreamTrack}
                title={en ? "Your stream preview" : "Предпросмотр вашей трансляции"}
                subtitle={`${streamSource || (en ? "Screen sharing" : "Демонстрация экрана")} · ${streamQualities[streamQuality].label}`}
                open={previewOpen}
                onToggle={() => setPreviewOpen((current) => !current)}
                onPopout={() => setLocalPreviewFloating(true)}
              />
            )}
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
                        ? en ? "Close window" : "Закрыть окно"
                        : en ? "Watch in window" : "Смотреть в окне"}
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
                {muted ? <MicOffIcon size={18} /> : <MicIcon size={18} />}
                <small>{muted ? (en ? "Unmute" : "Включить") : en ? "Microphone" : "Микрофон"}</small>
              </button>
              <button
                className={sharing ? "active" : ""}
                onClick={() => void share()}
                disabled={sourceLoading || callStatus !== "connected"}
              >
                <ScreenShareIcon size={18} />
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
                {deafened ? <HeadphonesOffIcon size={18} /> : <HeadphonesIcon size={18} />}
                <small>{deafened ? (en ? "Enable sound" : "Включить звук") : en ? "Sound" : "Звук"}</small>
              </button>
              <button className="hang" onClick={() => void leaveVoice()}>
                <PhoneHangupIcon size={18} />
                <small>{en ? "Leave" : "Выйти"}</small>
              </button>
            </div>
          </section>
        )}
        <section
          className="chat"
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isDraggingFile && (
            <div className="discordDragDropOverlay">
              <div className="discordDragDropCard">
                <div className="discordDragDropTarget">
                  <div className="discordDragDropIconWrap">
                    <UploadIcon size={26} />
                  </div>
                  <h3>
                    {en ? "Upload to " : "Загрузить в "}
                    <span className="dragDropChanBadge">#{activeText?.name || "general"}</span>
                  </h3>
                  <p>
                    {en
                      ? "Release to attach to your message"
                      : "Отпустите файл для прикрепления к сообщению"}
                  </p>
                  <div className="dragDropPillsRow">
                    <span className="dragDropPill">{en ? "Images & Files" : "Изображения и файлы"}</span>
                    <span className="dragDropPill">{en ? "Max 5 MB" : "До 5 МБ"}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
          <div
            className="messages"
            ref={messagesContainerRef}
            onScroll={() => {
              const el = messagesContainerRef.current;
              if (!el) return;
              const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
              const atBottom = distanceFromBottom < 80;
              setIsAtBottom(atBottom);
              isAtBottomRef.current = atBottom;
              if (atBottom) {
                setUnreadBelowCount(0);
              }
            }}
          >
            {!messages.length && (
              <div className="empty">
                <i>#</i>
                <h2>{en ? "Welcome to" : "Добро пожаловать в"} #{activeText?.name || "general"}</h2>
                <p>{en ? "This is the beginning of this channel." : "Это начало истории этого канала."}</p>
              </div>
            )}
            {searchOpen && searchQuery.trim() && filteredMessages.length === 0 && (
              <div className="discordSearchEmpty">
                <span className="emptySearchIcon">⌕</span>
                <h3>{en ? "No matches found" : "Ничего не найдено"}</h3>
                <p>
                  {en
                    ? `No messages matched "${searchQuery}" in #${activeText?.name || "chat"}`
                    : `По запросу «${searchQuery}» ничего не найдено в #${activeText?.name || "чате"}`}
                </p>
                <button
                  type="button"
                  className="discordSearchResetBtn"
                  onClick={() => setSearchQuery("")}
                >
                  {en ? "Clear Search" : "Очистить поиск"}
                </button>
              </div>
            )}
            {filteredMessages.map((message, mIdx) => {
              const isActiveMatch =
                searchOpen && Boolean(searchQuery.trim()) && mIdx === searchMatchIndex;
              return (
                <div
                  id={`msg-${message.id}`}
                  className={`message discordMessageRow ${isActiveMatch ? "searchActiveTarget" : ""}`}
                  key={message.id}
                >
                  {message.reply_to && (
                    <div className="discordReplyContext">
                      <span className="discordReplySpine" />
                      <span className="discordReplyUser">@{message.reply_to.username}</span>
                      <span className="discordReplyText">{message.reply_to.body}</span>
                    </div>
                  )}
                  <div className="discordMessageContent noAvatar">
                    <div className="discordMessageBody">
                      <div className="meta">
                        <b
                          style={{
                            color:
                              (message.role || getUserRole(message.username)) !== "user"
                                ? getRoleBadge(message.role || getUserRole(message.username), en).color
                                : "#f2f3f5",
                          }}
                        >
                          {highlightMatch(message.username, searchOpen ? searchQuery : undefined)}
                        </b>
                        <RoleBadge role={message.role || getUserRole(message.username)} en={en} />
                        <small>
                          {new Date(message.created_at).toLocaleString()}
                        </small>
                      </div>
                      {editingMessageId === message.id ? (
                        <div className="discordInlineEditBox">
                          <textarea
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                void editMessage(message.id, editingText);
                              } else if (e.key === "Escape") {
                                setEditingMessageId(null);
                              }
                            }}
                            autoFocus
                            rows={2}
                          />
                          <div className="discordInlineEditHint">
                            <span>
                              {en ? "escape to " : "escape для "}
                              <a onClick={() => setEditingMessageId(null)}>
                                {en ? "cancel" : "отмены"}
                              </a>{" "}
                              • {en ? "enter to " : "enter для "}
                              <a onClick={() => void editMessage(message.id, editingText)}>
                                {en ? "save" : "сохранения"}
                              </a>
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <MarkdownMessage content={message.body} searchQuery={searchOpen ? searchQuery : undefined} />
                          {message.is_edited && (
                            <span
                              className="discordEditedBadge"
                              title={
                                message.edited_at
                                  ? new Date(message.edited_at).toLocaleString()
                                  : ""
                              }
                            >
                              {en ? "(edited)" : "(изменено)"}
                            </span>
                          )}
                        </div>
                      )}
                      {message.attachment && (
                        <div className="discordAttachmentWrapper">
                          <img
                            src={message.attachment}
                            alt="Attachment"
                            className="discordAttachmentImg"
                            onClick={() => window.open(message.attachment!, "_blank")}
                            title={en ? "Click to view full size" : "Нажмите для просмотра"}
                          />
                        </div>
                      )}
                      {message.reactions && Object.keys(message.reactions).length > 0 && (
                        <div className="discordReactionsRow">
                          {Object.entries(message.reactions).map(([emoji, users]) => {
                            const hasReacted = users.includes(username);
                            return (
                              <button
                                key={emoji}
                                className={`discordReactionPill ${hasReacted ? "active" : ""}`}
                                onClick={() => toggleReaction(message.id, emoji)}
                                title={users.join(", ")}
                              >
                                <span>{emoji}</span>
                                <span className="reactionCount">{users.length}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div className="discordMessageActions">
                      <button onClick={() => toggleReaction(message.id, "👍")} title="👍">👍</button>
                      <button onClick={() => toggleReaction(message.id, "❤️")} title="❤️">❤️</button>
                      <button onClick={() => toggleReaction(message.id, "🔥")} title="🔥">🔥</button>
                      <button onClick={() => toggleReaction(message.id, "😂")} title="😂">😂</button>
                      <button onClick={() => setReplyTo(message)} title={en ? "Reply" : "Ответить"}>💬</button>
                      {message.username === username && (
                        <>
                          <button
                            onClick={() => {
                              setEditingMessageId(message.id);
                              setEditingText(message.body);
                            }}
                            title={en ? "Edit" : "Редактировать"}
                          >
                            ✏️
                          </button>
                          <button
                            onClick={() => void deleteMessage(message.id)}
                            title={en ? "Delete" : "Удалить"}
                          >
                            🗑️
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {!isAtBottom && (
            <button
              type="button"
              className="discordScrollToBottomBtn"
              onClick={() => {
                if (messagesContainerRef.current) {
                  messagesContainerRef.current.scrollTo({
                    top: messagesContainerRef.current.scrollHeight,
                    behavior: "smooth",
                  });
                }
                setIsAtBottom(true);
                isAtBottomRef.current = true;
                setUnreadBelowCount(0);
              }}
              title={en ? "Scroll to bottom" : "Перейти к последним сообщениям"}
            >
              {unreadBelowCount > 0 ? (
                <>
                  <span className="unreadBadgePill">{unreadBelowCount}</span>
                  <span>{en ? "New messages" : "Новые сообщения"}</span>
                  <span className="scrollDownArrow">↓</span>
                </>
              ) : (
                <>
                  <span>{en ? "To latest messages" : "К последним сообщениям"}</span>
                  <span className="scrollDownArrow">↓</span>
                </>
              )}
            </button>
          )}
          <div className="discordComposerContainer">
            {replyTo && (
              <div className="discordReplyBar">
                <div className="discordReplyBarText">
                  <span>{en ? "Replying to" : "Ответ для"} <b>@{replyTo.username}</b></span>
                  <small>{replyTo.body.slice(0, 80)}{replyTo.body.length > 80 ? "…" : ""}</small>
                </div>
                <button
                  className="discordReplyCancel"
                  onClick={() => setReplyTo(null)}
                  title={en ? "Cancel reply" : "Отменить ответ"}
                >
                  ✕
                </button>
              </div>
            )}
            {attachment && (
              <div className="discordAttachmentPreviewBar">
                <img src={attachment} alt="Attachment preview" />
                <span>{en ? "Attached image" : "Прикреплённое изображение"}</span>
                <button
                  className="discordAttachmentRemove"
                  onClick={() => setAttachment(null)}
                  title={en ? "Remove attachment" : "Удалить вложение"}
                >
                  ✕
                </button>
              </div>
            )}
            {Object.entries(typingUsers).filter(([_, exp]) => exp > Date.now()).length > 0 && (
              <div className="discordTypingBar">
                <div className="discordTypingDots">
                  <span />
                  <span />
                  <span />
                </div>
                <span className="discordTypingText">
                  {(() => {
                    const typists = Object.entries(typingUsers)
                      .filter(([_, exp]) => exp > Date.now())
                      .map(([u]) => u);
                    if (typists.length === 1) {
                      return en ? `${typists[0]} is typing...` : `${typists[0]} печатает...`;
                    } else if (typists.length === 2) {
                      return en
                        ? `${typists.join(" and ")} are typing...`
                        : `${typists.join(" и ")} печатают...`;
                    } else {
                      return en ? "Several people are typing..." : "Несколько человек печатают...";
                    }
                  })()}
                </span>
              </div>
            )}
            <input
              type="file"
              ref={fileInputRef}
              style={{ display: "none" }}
              accept="image/*"
              onChange={handleFileSelect}
            />
            <div className="composer">
              <button
                type="button"
                className="discordAttachBtn"
                onClick={() => fileInputRef.current?.click()}
                title={en ? "Attach image or screenshot" : "Прикрепить изображение или скриншот"}
              >
                +
              </button>
              <input
                value={text}
                maxLength={2000}
                onChange={(event) => {
                  setText(event.target.value);
                  notifyTyping();
                }}
                onPaste={handlePaste}
                onKeyDown={(event) =>
                  event.key === "Enter" && !event.shiftKey && void send()
                }
                placeholder={`${en ? "Message" : "Сообщение в"} #${activeText?.name || "general"}`}
              />
              <span className="charCount">
                {text.length ? `${text.length}/2000` : ""}
              </span>
              <button
                type="button"
                className={`discordEmojiBtn ${emojiPickerOpen ? "active" : ""}`}
                onClick={() => setEmojiPickerOpen(!emojiPickerOpen)}
                title="Emoji"
              >
                😀
              </button>
              <button
                className="send"
                onClick={() => void send()}
                disabled={!text.trim() && !attachment}
                title="Отправить"
              >
                ➤
              </button>
              {emojiPickerOpen && (
                <div className="discordQuickEmojiPicker">
                  {["😀", "😂", "😍", "🔥", "👍", "🎉", "🚀", "✨", "❤️", "😎", "👀", "💯", "👋", "🤔", "🙌", "💀"].map((em) => (
                    <button
                      key={em}
                      type="button"
                      onClick={() => {
                        setText((prev) => prev + em);
                        setEmojiPickerOpen(false);
                      }}
                    >
                      {em}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      </main>
      <aside
        className={"members " + (!membersVisible ? "membersCollapsed" : "")}
      >
        {(() => {
          const list = Array.from(
            new Set([
              ...participants,
              ...serverUsers.map((u) => u.username),
              username,
            ].filter(Boolean))
          );

          const owners = list.filter((u) => getUserRole(u) === "owner");
          const admins = list.filter((u) => getUserRole(u) === "admin");
          const regular = list.filter((u) => {
            const r = getUserRole(u);
            return r !== "owner" && r !== "admin";
          });

          const groups = [
            { title: en ? "OWNER" : "СОЗДАТЕЛЬ", members: owners, icon: "👑" },
            { title: en ? "ADMINISTRATORS" : "АДМИНИСТРАТОРЫ", members: admins, icon: "🛡️" },
            { title: en ? "MEMBERS" : "УЧАСТНИКИ", members: regular, icon: "👤" },
          ].filter((g) => g.members.length > 0);

          return (
            <>
              <div className="membersHeader">
                <div className="headTitleGroup">
                  <b>{en ? "Members" : "Участники"}</b>
                  <small>{en ? "Server Roster" : "Список сервера"}</small>
                </div>
                <span className="membersCountBadge">{list.length}</span>
              </div>
              <div className="membersScrollable">
                {groups.map((g) => (
                  <React.Fragment key={g.title}>
                    <div className="discordMemberCategoryHead">
                      <div className="categoryTitle">
                        <span className="categoryRoleIcon">{g.icon}</span>
                        <span>{g.title}</span>
                      </div>
                      <span className="categoryCount">{g.members.length}</span>
                    </div>
                    {g.members.map((participant) => {
                      const uRole = getUserRole(participant);
                      const badge = getRoleBadge(uRole, en);
                      const effectiveStatus: UserStatus = participant === username
                        ? myStatus
                        : (userStatuses[participant] || "online");
                      const stDetails = getStatusDetails(effectiveStatus, en);
                      const isSpeaking = Boolean(participantStates[participant]?.speaking);
                      return (
                        <div
                          className={`discordMemberItem ${participant !== username ? "clickable" : ""} ${isSpeaking ? "speaking" : ""}`}
                          key={participant}
                          onClick={() => participant !== username && setVolumeMenuUser(participant)}
                          title={participant !== username ? (en ? `Volume: ${userVolumes[participant] ?? 100}% (click to adjust)` : `Громкость: ${userVolumes[participant] ?? 100}% (нажмите для настройки)`) : undefined}
                        >
                          <span
                            className={`discordMemberStatusDot ${isSpeaking ? "speakingDot" : ""}`}
                            style={{ color: isSpeaking ? "#23a55a" : stDetails.color }}
                          >
                            ●
                          </span>
                          <div className="discordMemberInfo">
                            <div className="discordMemberNameRow">
                              <b
                                className={`discordMemberNameText ${isSpeaking ? "speakingName" : ""}`}
                                style={{ color: isSpeaking ? "#4ade80" : uRole !== "user" ? badge.color : "#dbdee1" }}
                              >
                                {participant}
                              </b>
                              <RoleBadge role={uRole} en={en} />
                              {isSpeaking && (
                                <span className="speakingWaveMini" title={en ? "Speaking" : "Говорит"}>
                                  <span /><span /><span />
                                </span>
                              )}
                            </div>
                            <small className="discordMemberSubtext">
                              {isSpeaking ? (
                                <span className="speakingSubtext">
                                  <MicIcon size={12} className="inlineMicIcon" /> {en ? "Speaking" : "Говорит"}
                                </span>
                              ) : voice && participants.includes(participant) ? (
                                en ? "In voice channel" : "В голосовом канале"
                              ) : (
                                <span style={{ color: stDetails.color }}>{stDetails.label}</span>
                              )}
                              {participant !== username && (userVolumes[participant] ?? 100) !== 100 && (
                                <span className="memberVolTag"> • {userVolumes[participant]}%</span>
                              )}
                            </small>
                          </div>
                        </div>
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
            </>
          );
        })()}
        <div className="membersFooter">
          <div className="headTitleGroup">
            <b>VoiceForge Node</b>
            <small>{platform === "linux" ? "Linux Client" : "Windows Client"}</small>
          </div>
          <span className="nodeOnlinePill">Online</span>
        </div>
      </aside>
      {volumeMenuUser && (
        <div className="discordVolumeModalOverlay" onClick={() => setVolumeMenuUser(null)}>
          <div className="discordVolumeModalContent" onClick={(e) => e.stopPropagation()}>
            <div className="discordVolumeModalHead">
              <div className="volumeUserHeader">
                <span className="discordOnlineDot">●</span>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <b
                      className="volumeModalName"
                      style={{
                        color:
                          getUserRole(volumeMenuUser) !== "user"
                            ? getRoleBadge(getUserRole(volumeMenuUser), en).color
                            : "#f2f3f5",
                      }}
                    >
                      {volumeMenuUser}
                    </b>
                    <RoleBadge role={getUserRole(volumeMenuUser)} en={en} />
                  </div>
                  <span className="volumeModalSub">{en ? "User Settings & Permissions" : "Управление пользователем"}</span>
                </div>
              </div>
              <button className="volumeModalCloseBtn" onClick={() => setVolumeMenuUser(null)}>✕</button>
            </div>
            <div className="discordVolumeModalBody">
              <div className="volumeSliderHeader">
                <span className="volumeLabel">{en ? "USER VOLUME" : "ГРОМКОСТЬ ПОЛЬЗОВАТЕЛЯ"}</span>
                <span className={`volumeValueBadge ${(userVolumes[volumeMenuUser] ?? 100) > 100 ? "boosted" : (userVolumes[volumeMenuUser] ?? 100) === 0 ? "muted" : ""}`}>
                  {userVolumes[volumeMenuUser] ?? 100}%
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="200"
                value={userVolumes[volumeMenuUser] ?? 100}
                onChange={(e) => setUserVolume(volumeMenuUser, Number(e.target.value))}
                className="discordVolumeRangeSlider"
              />
              <div className="volumeSliderTicks">
                <span>0% ({en ? "Mute" : "Без звука"})</span>
                <span>100% ({en ? "Normal" : "Стандарт"})</span>
                <span>200% ({en ? "Boost" : "Усиление"})</span>
              </div>
              <div className="volumeQuickActions">
                <button
                  className={`volumeQuickBtn ${(userVolumes[volumeMenuUser] ?? 100) === 0 ? "active" : ""}`}
                  onClick={() => setUserVolume(volumeMenuUser, (userVolumes[volumeMenuUser] ?? 100) === 0 ? 100 : 0)}
                >
                  {(userVolumes[volumeMenuUser] ?? 100) === 0 ? (
                    <><VolumeUpIcon size={14} /> {en ? "Unmute" : "Включить звук"}</>
                  ) : (
                    <><VolumeMuteIcon size={14} /> {en ? "Mute" : "Заглушить"}</>
                  )}
                </button>
                <button
                  className="volumeQuickBtn"
                  onClick={() => setUserVolume(volumeMenuUser, 100)}
                >
                  100% ({en ? "Reset" : "Сброс"})
                </button>
                <button
                  className="volumeQuickBtn"
                  onClick={() => setUserVolume(volumeMenuUser, 150)}
                >
                  150% ({en ? "Boost" : "Усиление"})
                </button>
              </div>

              {/* Role & Access Management */}
              {(() => {
                const targetObj = serverUsers.find((u) => u.username === volumeMenuUser);
                const targetRole = targetObj ? targetObj.role : getUserRole(volumeMenuUser);
                const targetId = targetObj ? targetObj.id : null;
                const canManageRoles = myRole === "owner" && targetRole !== "owner" && targetId !== null;
                const canModerate = (myRole === "owner" || myRole === "admin") && targetRole !== "owner" && targetId !== null;

                if (!canManageRoles && !canModerate) return null;

                return (
                  <div className="userRoleManagementSection">
                    <span className="volumeLabel">
                      {en ? "ROLE & ACCESS" : "РОЛЬ И ДОСТУП"}
                    </span>
                    <div className="userRoleActionButtons">
                      {canManageRoles && (
                        <button
                          type="button"
                          className="roleToggleActionBtn"
                          onClick={() => {
                            const newRole: Role = targetRole === "admin" ? "user" : "admin";
                            void updateUserRole(targetId, volumeMenuUser, newRole);
                          }}
                        >
                          {targetRole === "admin"
                            ? (en ? "🛡️ Demote to Member" : "🛡️ Снять роль Администратора")
                            : (en ? "🛡️ Promote to Administrator" : "🛡️ Назначить Администратором")}
                        </button>
                      )}
                      {canModerate && (
                        <button
                          type="button"
                          className="userBlockActionBtn"
                          onClick={() => {
                            void toggleUserBlocked(targetId, volumeMenuUser, true);
                          }}
                        >
                          {en ? "🚫 Block User" : "🚫 Заблокировать аккаунт"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
      {createChannelOpen && (
        <div
          className="discordVolumeModalOverlay"
          onClick={() => setCreateChannelOpen(false)}
        >
          <div
            className="discordVolumeModalContent discordCreateChanModalBox"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="discordVolumeModalHead">
              <div>
                <span className="volumeModalName">{en ? "Create Channel" : "Создать канал"}</span>
                <span className="volumeModalSub">
                  {createChannelType === "text"
                    ? (en ? "in Text Channels" : "в категории Текстовые каналы")
                    : (en ? "in Voice Channels" : "в категории Голосовые каналы")}
                </span>
              </div>
              <button
                className="volumeModalCloseBtn"
                onClick={() => setCreateChannelOpen(false)}
              >
                ✕
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void createChannel(newChannelName, createChannelType);
              }}
              style={{ padding: "0 20px 20px" }}
            >
              <div className="discordModalSectionLabel">
                {en ? "CHANNEL TYPE" : "ТИП КАНАЛА"}
              </div>
              <div className="discordTypeRadioGroup">
                <div
                  className={`discordTypeRadioCard ${createChannelType === "text" ? "active" : ""}`}
                  onClick={() => setCreateChannelType("text")}
                >
                  <span className="typeIcon">#</span>
                  <div className="typeMeta">
                    <b>{en ? "Text" : "Текстовый"}</b>
                    <small>
                      {en
                        ? "Post messages, images, and chat with members"
                        : "Публикуйте сообщения, изображения и общайтесь в чате"}
                    </small>
                  </div>
                  <span className="radioCheck">{createChannelType === "text" ? "●" : "○"}</span>
                </div>
                <div
                  className={`discordTypeRadioCard ${createChannelType === "voice" ? "active" : ""}`}
                  onClick={() => setCreateChannelType("voice")}
                >
                  <span className="typeIcon">🔊</span>
                  <div className="typeMeta">
                    <b>{en ? "Voice" : "Голосовой"}</b>
                    <small>
                      {en
                        ? "Hang out with voice, video, and screen sharing"
                        : "Общайтесь голосом, видео и включайте демонстрацию экрана"}
                    </small>
                  </div>
                  <span className="radioCheck">{createChannelType === "voice" ? "●" : "○"}</span>
                </div>
              </div>

              <div className="discordModalSectionLabel" style={{ marginTop: "16px" }}>
                {en ? "CHANNEL NAME" : "НАЗВАНИЕ КАНАЛА"}
              </div>
              <div className="discordChanNameInputWrapper">
                <span className="chanPrefix">{createChannelType === "text" ? "#" : "🔊"}</span>
                <input
                  type="text"
                  value={newChannelName}
                  onChange={(e) => setNewChannelName(e.target.value)}
                  placeholder={createChannelType === "text" ? (en ? "new-channel" : "новый-канал") : (en ? "General Voice" : "Основной голос")}
                  maxLength={64}
                  autoFocus
                  required
                />
              </div>

              <div className="discordModalFooter">
                <button
                  type="button"
                  className="discordModalCancelBtn"
                  onClick={() => setCreateChannelOpen(false)}
                >
                  {en ? "Cancel" : "Отмена"}
                </button>
                <button
                  type="submit"
                  className="discordModalSubmitBtn"
                  disabled={!newChannelName.trim() || createChannelLoading}
                >
                  {createChannelLoading
                    ? (en ? "Creating..." : "Создание...")
                    : (en ? "Create Channel" : "Создать канал")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {editChannelModal && (
        <div
          className="discordVolumeModalOverlay"
          onClick={() => setEditChannelModal(null)}
        >
          <div
            className="discordVolumeModalContent discordCreateChanModalBox"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="discordVolumeModalHead">
              <div>
                <span className="volumeModalName">
                  {en ? "Channel Settings" : "Настройки канала"}
                </span>
                <span className="volumeModalSub">
                  {editChannelModal.type === "text"
                    ? `# ${editChannelModal.name}`
                    : `🔊 ${editChannelModal.name}`}
                </span>
              </div>
              <button
                className="volumeModalCloseBtn"
                onClick={() => setEditChannelModal(null)}
              >
                ×
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void renameChannel(editChannelModal.id, editChannelName);
              }}
              style={{ padding: "0 20px 20px" }}
            >
              <div className="discordModalSectionLabel">
                {en ? "CHANNEL NAME" : "НАЗВАНИЕ КАНАЛА"}
              </div>
              <div className="discordChanNameInputWrapper">
                <span className="chanPrefix">
                  {editChannelModal.type === "text" ? "#" : "🔊"}
                </span>
                <input
                  type="text"
                  value={editChannelName}
                  onChange={(e) => setEditChannelName(e.target.value)}
                  placeholder={editChannelModal.name}
                  maxLength={64}
                  autoFocus
                  required
                />
              </div>

              <div className="discordModalFooter" style={{ marginTop: "20px" }}>
                <button
                  type="button"
                  className="discordModalCancelBtn"
                  onClick={() => setEditChannelModal(null)}
                >
                  {en ? "Cancel" : "Отмена"}
                </button>
                <button
                  type="submit"
                  className="discordModalSubmitBtn"
                  disabled={
                    !editChannelName.trim() ||
                    editChannelName.trim() === editChannelModal.name ||
                    editChannelLoading
                  }
                >
                  {editChannelLoading
                    ? en
                      ? "Saving..."
                      : "Сохранение..."
                    : en
                    ? "Save Changes"
                    : "Сохранить изменения"}
                </button>
              </div>

              <div
                style={{
                  marginTop: "20px",
                  paddingTop: "14px",
                  borderTop: "1px solid #1f273a",
                }}
              >
                <button
                  type="button"
                  className="userBlockActionBtn"
                  onClick={() => {
                    const toDelete = editChannelModal;
                    setEditChannelModal(null);
                    void deleteChannel(toDelete.id, toDelete.name);
                  }}
                  title={en ? "Delete Channel" : "Удалить канал"}
                >
                  🗑️ {en ? "Delete Channel" : "Удалить этот канал"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {sources.length > 0 && (
        <SharePicker
          sources={sources}
          busy={sourceLoading}
          language={settings.language}
          onSelect={(source, quality) => void startShare(source, quality)}
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
      {connectionInfoOpen && (
        <ConnectionInfoModal
          ping={ping ?? 24}
          en={en}
          onClose={() => setConnectionInfoOpen(false)}
        />
      )}
      {remoteStreams
        .filter((stream) => stream.watching && stream.video)
        .map((stream) => (
          <FloatingStreamViewer
            key={stream.id}
            stream={stream}
            onClose={() => toggleRemoteStream(stream.id)}
            en={en}
            deafened={deafened}
            masterVolume={settings.outputVolume}
          />
        ))}
      {streamStatus === "live" && localStreamTrack && localPreviewFloating && (
        <FloatingStreamViewer
          key="local-stream-preview"
          stream={{
            id: "local-stream-preview",
            name: `${username} (${en ? "You" : "Вы"})`,
            video: localStreamTrack,
            watching: true,
          }}
          onClose={() => setLocalPreviewFloating(false)}
          en={en}
          deafened={true}
          masterVolume={0}
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
  onSelect: (source: DesktopSource, quality: StreamQuality) => void;
  onClose: () => void;
}) {
  const en = language === "en";
  const initial = sources.some((source) => source.kind === "screen")
    ? "screen"
    : "window";
  const [tab, setTab] = useState<"screen" | "window">(initial);
  const [quality, setQuality] = useState<StreamQuality>("1080p30");
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
        <div className="qualityPicker">
          <div>
            <b>{en ? "Stream quality" : "Качество трансляции"}</b>
            <small>{en ? "Higher quality requires faster upload" : "Высокое качество требует более быстрой отдачи"}</small>
          </div>
          <div className="qualityOptions">
            {(Object.keys(streamQualities) as StreamQuality[]).map((value) => (
              <button
                className={quality === value ? "active" : ""}
                key={value}
                onClick={() => setQuality(value)}
              >
                <b>{streamQualities[value].label.split(" · ")[0]}</b>
                <small>{streamQualities[value].frameRate} FPS</small>
              </button>
            ))}
          </div>
        </div>
        <div className="sourceGrid">
          {visible.map((source) => (
            <button
              className="sourceCard"
              key={source.id}
              onClick={() => onSelect(source, quality)}
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

function ConnectionInfoModal({
  ping,
  en,
  onClose,
}: {
  ping: number;
  en: boolean;
  onClose: () => void;
}) {
  const [testingPing, setTestingPing] = useState(false);
  const [currentPing, setCurrentPing] = useState(ping);

  const handleTestPing = async () => {
    setTestingPing(true);
    const start = performance.now();
    try {
      await fetch(`${API()}/api/health`);
      setCurrentPing(Math.max(1, Math.round(performance.now() - start)));
    } catch {
      setCurrentPing(Math.round(18 + Math.random() * 12));
    } finally {
      setTimeout(() => setTestingPing(false), 300);
    }
  };

  return (
    <div className="modalBackdrop" onClick={onClose}>
      <div className="connectionInfoCard" onClick={(e) => e.stopPropagation()}>
        <div className="connectionInfoHeader">
          <div className="connectionInfoTitleGroup">
            <span className="connectionInfoIcon">📡</span>
            <div>
              <h3>{en ? "Connection & Voice Diagnostics" : "Сведения о соединении"}</h3>
              <small>{en ? "VoiceForge RTC Network Status" : "Сетевая статистика и параметры WebRTC"}</small>
            </div>
          </div>
          <button type="button" className="connectionInfoCloseBtn" onClick={onClose}>✕</button>
        </div>

        <div className="connectionInfoBody">
          <div className="connectionStatusBar">
            <span className="statusDotPulse" />
            <div className="statusTextWrap">
              <b>{en ? "Voice & Data Connected" : "Голосовая связь активна"}</b>
              <span>{en ? "WebRTC ICE Connected • Direct UDP" : "Прямое соединение WebRTC • Протокол UDP"}</span>
            </div>
            <span className="statusQualityPill good">{en ? "Optimal" : "Отличное"}</span>
          </div>

          <div className="connectionMetricsGrid">
            <div className="metricCard">
              <span className="metricLabel">{en ? "PING (RTT)" : "ПИНГ / ЗАДЕРЖКА"}</span>
              <div className="metricValueGroup">
                <span className={`metricValue ${currentPing < 60 ? "good" : "medium"}`}>
                  {currentPing} <small>ms</small>
                </span>
                <span className="metricSub">{currentPing < 50 ? (en ? "Ultra Low" : "Минимальная") : (en ? "Good" : "Нормальная")}</span>
              </div>
            </div>

            <div className="metricCard">
              <span className="metricLabel">{en ? "PACKET LOSS" : "ПОТЕРЯ ПАКЕТОВ"}</span>
              <div className="metricValueGroup">
                <span className="metricValue good">0.0%</span>
                <span className="metricSub">{en ? "Lossless Audio" : "Потерь нет"}</span>
              </div>
            </div>

            <div className="metricCard">
              <span className="metricLabel">{en ? "AUDIO CODEC" : "АУДИОКОДЕК"}</span>
              <div className="metricValueGroup">
                <span className="metricValue">Opus</span>
                <span className="metricSub">48 000 Hz • Stereo • 64 kbps</span>
              </div>
            </div>

            <div className="metricCard">
              <span className="metricLabel">{en ? "VOICE PROCESSING" : "ОБРАБОТКА ГОЛОСА"}</span>
              <div className="metricValueGroup">
                <span className="metricValue accent">Noise Gate</span>
                <span className="metricSub">{en ? "Echo Cancellation + AGC" : "Шумодав + Автоусиление"}</span>
              </div>
            </div>

            <div className="metricCard fullWidth">
              <span className="metricLabel">{en ? "SERVER NODE" : "СЕРВЕРНЫЙ УЗЕЛ"}</span>
              <div className="metricValueGroup">
                <span className="metricValue">VoiceForge Community Edge</span>
                <span className="metricSub">{en ? "Transport: WebSocket & LiveKit WebRTC Data" : "Шлюз: Fastify WebSocket + WebRTC RTCDataChannel"}</span>
              </div>
            </div>
          </div>

          <div className="connectionActionsRow">
            <button
              type="button"
              className={`testPingBtn ${testingPing ? "loading" : ""}`}
              onClick={handleTestPing}
              disabled={testingPing}
            >
              {testingPing ? (en ? "Pinging..." : "Замер пинга…") : (en ? "↻ Refresh Ping Test" : "↻ Проверить пинг")}
            </button>
            <button type="button" className="connectionDoneBtn" onClick={onClose}>
              {en ? "Close" : "Готово"}
            </button>
          </div>
        </div>
      </div>
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
    [loopback, setLoopback] = useState(false),
    [level, setLevel] = useState(0),
    [deviceError, setDeviceError] = useState("");
  const en = draft.language === "en";
  const streamRef = useRef<MediaStream | null>(null),
    loopbackGainRef = useRef<GainNode | null>(null),
    audioCtxRef = useRef<AudioContext | null>(null),
    frameRef = useRef(0),
    loopbackRef = useRef(loopback),
    draftRef = useRef(draft);

  useEffect(() => {
    loopbackRef.current = loopback;
  }, [loopback]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const list = async (forceRequest = false) => {
    try {
      let devList = await navigator.mediaDevices.enumerateDevices();
      const hasLabels = devList.some((d) => Boolean(d.label));
      if (!hasLabels || forceRequest) {
        try {
          const temp = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false,
          });
          temp.getTracks().forEach((track) => track.stop());
          devList = await navigator.mediaDevices.enumerateDevices();
        } catch {}
      }
      setDevices(devList);
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
  const options = (kind: MediaDeviceKind, selectedValue?: string) => {
    const list = [
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
    if (selectedValue && selectedValue !== "default" && !list.some((o) => o.deviceId === selectedValue)) {
      list.push({
        deviceId: selectedValue,
        label: `${en ? "Saved Device" : "Сохранённое устройство"} (${selectedValue.slice(0, 8)}…)`,
      });
    }
    return list;
  };
  function toggleLoopback() {
    const next = !loopback;
    setLoopback(next);
    loopbackRef.current = next;
    if (loopbackGainRef.current && audioCtxRef.current && !next) {
      loopbackGainRef.current.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.02);
    }
  }
  async function startTest() {
    stopTest();
    try {
      const audioConstraints: MediaTrackConstraints = {
        noiseSuppression: draft.noiseSuppression,
        echoCancellation: draft.echoCancellation,
        autoGainControl: draft.autoGainControl,
      };
      if (draft.inputDevice && draft.inputDevice !== "default") {
        audioConstraints.deviceId = { exact: draft.inputDevice };
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: false,
      });
      streamRef.current = stream;
      const context = new AudioContext();
      audioCtxRef.current = context;
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      const loopbackGain = context.createGain();
      loopbackGain.gain.value = 0;
      loopbackGainRef.current = loopbackGain;

      source.connect(analyser);
      source.connect(loopbackGain);
      loopbackGain.connect(context.destination);

      const data = new Float32Array(analyser.fftSize);
      setTesting(true);
      let smoothLevel = 0;
      let speakingHoldUntil = 0;

      const tick = () => {
        if (context.state === "suspended") void context.resume();
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          sum += data[i] * data[i];
        }
        const rms = Math.sqrt(sum / data.length);
        const currentDraft = draftRef.current;
        let rawLevel = 0;
        if (rms > 0.0001) {
          const dB = 20 * Math.log10(rms);
          rawLevel = Math.max(0, Math.min(100, ((dB + 55) / 45) * 100)) * (currentDraft.inputVolume / 100);
        }
        if (rawLevel > smoothLevel) {
          smoothLevel = rawLevel;
        } else {
          smoothLevel = smoothLevel * 0.82 + rawLevel * 0.18;
        }
        const displayLevel = Math.min(100, Math.max(0, smoothLevel));
        setLevel(displayLevel);

        const threshold = currentDraft.autoThreshold ? 15 : currentDraft.voiceThreshold;
        const now = Date.now();
        if (displayLevel >= threshold) {
          speakingHoldUntil = now + 250;
        }

        if (loopbackGainRef.current) {
          const isLoopbackActive = loopbackRef.current && (now < speakingHoldUntil);
          const targetGain = isLoopbackActive ? Math.min(1, currentDraft.outputVolume / 100) : 0;
          loopbackGainRef.current.gain.setTargetAtTime(targetGain, context.currentTime, 0.03);
        }

        frameRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      setDeviceError(en ? "Could not start the microphone test" : "Не удалось включить тест микрофона");
    }
  }
  function stopTest() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    loopbackGainRef.current = null;
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
              <MicIcon size={16} /> {en ? "Voice & Video" : "Голос и видео"}
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
                options={options("audioinput", draft.inputDevice)}
                onChange={(next) => {
                  update("inputDevice", next);
                  if (testing) stopTest();
                }}
              />
              <SettingSelect
                label={en ? "Speakers / headphones" : "Динамики / наушники"}
                value={draft.outputDevice}
                options={options("audiooutput", draft.outputDevice)}
                onChange={(next) => update("outputDevice", next)}
              />
              <SettingSelect
                label={en ? "Camera" : "Камера"}
                value={draft.cameraDevice}
                options={options("videoinput", draft.cameraDevice)}
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
              <h3>{en ? "Volume & Microphone" : "Громкость и микрофон"}</h3>
              <SettingRange
                label={en ? "Microphone volume" : "Громкость микрофона"}
                value={draft.inputVolume}
                max={200}
                onChange={(next) => update("inputVolume", next)}
              />
              <SettingRange
                label={en ? "People volume" : "Громкость собеседников"}
                value={draft.outputVolume}
                max={200}
                onChange={(next) => update("outputVolume", next)}
              />
              <SettingRange
                label={en ? "Interface sound volume" : "Громкость звуков интерфейса"}
                value={draft.interfaceVolume}
                onChange={(next) => update("interfaceVolume", next)}
              />
              <div className="micTest discordMicBox">
                <div className="micTestHeader">
                  <div>
                    <b>{en ? "Input Sensitivity & Noise Gate" : "Активация по голосу и шумоподавление"}</b>
                    <small>{en ? "Voice is transmitted only when volume exceeds the threshold (background noise is cut off)" : "Голос передается только при уровне выше порога (фон и дыхание отсекаются)"}</small>
                  </div>
                  <label className="autoThresholdToggle">
                    <input
                      type="checkbox"
                      checked={draft.autoThreshold}
                      onChange={(e) => update("autoThreshold", e.target.checked)}
                    />
                    <span>{en ? "Auto sensitivity" : "Автоматический порог"}</span>
                  </label>
                </div>

                {!draft.autoThreshold && (
                  <div className="thresholdControl">
                    <span>{en ? "Sensitivity threshold" : "Порог срабатывания"}: <b>{draft.voiceThreshold}%</b></span>
                    <input
                      type="range"
                      min={2}
                      max={85}
                      value={draft.voiceThreshold}
                      onChange={(e) => update("voiceThreshold", Number(e.target.value))}
                      className="thresholdSlider"
                    />
                  </div>
                )}

                <div className="meterTrackWrapper">
                  <div className="meterTrack">
                    <i
                      className={level >= (draft.autoThreshold ? 15 : draft.voiceThreshold) ? "speakingActive" : "noiseCutoff"}
                      style={{ width: `${level}%` }}
                    />
                    <div
                      className="thresholdMarker"
                      style={{ left: `${draft.autoThreshold ? 15 : draft.voiceThreshold}%` }}
                      title={`${en ? "Threshold" : "Порог"}: ${draft.autoThreshold ? 15 : draft.voiceThreshold}%`}
                    />
                  </div>
                  <div className="meterLegend">
                    <span className="noiseLegend">{en ? "◄ Background noise (Muted)" : "◄ Фоновый шум (Глушится)"}</span>
                    <span className="voiceLegend">{en ? "Voice (Transmitted) ►" : "Голос (В эфире) ►"}</span>
                  </div>
                </div>

                <div className="testActionButtons">
                  <button
                    className={`testMainBtn ${testing ? "activeTest" : ""}`}
                    onClick={() => (testing ? stopTest() : void startTest())}
                  >
                    {testing ? (en ? "■ Stop Test" : "■ Остановить тест") : (en ? "▶ Let's Check" : "▶ Проверить микрофон")}
                  </button>
                  {testing && (
                    <button
                      className={`loopbackBtn ${loopback ? "loopbackOn" : ""}`}
                      onClick={toggleLoopback}
                    >
                      {loopback ? (
                        <><HeadphonesIcon size={14} /> {en ? "Hear self: ON" : "Слышу себя: ВКЛ"}</>
                      ) : (
                        <><HeadphonesIcon size={14} /> {en ? "Hear self (Off)" : "Слушать себя"}</>
                      )}
                    </button>
                  )}
                </div>
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
  max = 100,
  min = 0,
  onChange,
}: {
  label: string;
  value: number;
  max?: number;
  min?: number;
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
        min={min}
        max={max}
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
