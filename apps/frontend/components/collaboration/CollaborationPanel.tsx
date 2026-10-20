"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { MessageCircle, MonitorUp, Users, X } from "lucide-react";
import { getDeviceId } from "@/lib/api";

type Peer = { userId: string; displayName: string; role: string };
type ChatMessage = { id: string; userId: string; displayName: string; text: string; timestamp: number };
type SignalPayload =
  | { type: "offer"; description: RTCSessionDescriptionInit }
  | { type: "answer"; description: RTCSessionDescriptionInit }
  | { type: "candidate"; candidate: RTCIceCandidateInit };

const rtcConfig: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export default function CollaborationPanel() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"people" | "chat">("people");
  const [peers, setPeers] = useState<Peer[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [connected, setConnected] = useState(false);
  const [sharingWith, setSharingWith] = useState<string | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const socketRef = useRef<WebSocket | null>(null);
  const pcsRef = useRef(new Map<string, RTCPeerConnection>());
  const streamsRef = useRef(new Map<string, MediaStream>());
  const lastCursorRef = useRef(0);
  const peersRef = useRef<Peer[]>([]);

  const send = useCallback((value: unknown) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
  }, []);

  const sendSignal = useCallback((targetUserId: string, payload: SignalPayload) => {
    send({ type: "screen-share-signal", targetUserId, payload });
  }, [send]);

  const makePeerConnection = useCallback((userId: string) => {
    const previous = pcsRef.current.get(userId);
    if (previous) return previous;
    const pc = new RTCPeerConnection(rtcConfig);
    pc.onicecandidate = (event) => {
      if (event.candidate) sendSignal(userId, { type: "candidate", candidate: event.candidate.toJSON() });
    };
    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (stream) setRemoteStreams((current) => ({ ...current, [userId]: stream }));
    };
    pc.onconnectionstatechange = () => {
      if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
        setRemoteStreams((current) => {
          const next = { ...current };
          delete next[userId];
          return next;
        });
      }
    };
    pcsRef.current.set(userId, pc);
    return pc;
  }, [sendSignal]);

  useEffect(() => {
    let retry: number | undefined;
    let disposed = false;
    const connect = () => {
      if (disposed) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${window.location.hostname}:4000/api/auth/socket`);
      socketRef.current = socket;
      socket.addEventListener("open", () => {
        if (disposed) return socket.close();
        setConnected(true);
        socket.send(JSON.stringify({ type: "activity", deviceId: getDeviceId() }));
      });
      socket.addEventListener("message", (event) => {
        let data: Record<string, unknown>;
        try { data = JSON.parse(String(event.data)) as Record<string, unknown>; } catch { return; }
        if (data.type === "presence" && Array.isArray(data.users)) {
          const next = data.users.filter((item): item is Peer =>
            !!item && typeof item === "object" &&
            typeof (item as Peer).userId === "string" &&
            typeof (item as Peer).displayName === "string",
          );
          peersRef.current = next;
          setPeers(next);
          return;
        }
        if (data.type === "chat" && typeof data.text === "string") {
          setMessages((current) => [...current.slice(-99), data as unknown as ChatMessage]);
          return;
        }
        if (data.type === "screen-share-signal" && typeof data.fromUserId === "string") {
          const from = data.fromUserId;
          const payload = data.payload as SignalPayload | undefined;
          if (!payload || typeof payload !== "object") return;
          void (async () => {
            const pc = makePeerConnection(from);
            if (payload.type === "offer" && "description" in payload) {
              await pc.setRemoteDescription(payload.description);
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              sendSignal(from, { type: "answer", description: answer });
            } else if (payload.type === "answer" && "description" in payload) {
              await pc.setRemoteDescription(payload.description);
            } else if (payload.type === "candidate" && "candidate" in payload) {
              try { await pc.addIceCandidate(payload.candidate); } catch { /* late ICE after peer teardown */ }
            }
          })().catch((error) => console.warn("Collaboration signaling failed", error));
        }
      });
      socket.addEventListener("close", () => {
        if (socketRef.current === socket) socketRef.current = null;
        setConnected(false);
        if (!disposed) retry = window.setTimeout(connect, 3000);
      });
      socket.addEventListener("error", () => socket.close());
    };
    connect();
    return () => {
      disposed = true;
      if (retry !== undefined) window.clearTimeout(retry);
      socketRef.current?.close(1000, "Collaboration panel unmounted");
      socketRef.current = null;
      for (const pc of pcsRef.current.values()) pc.close();
      pcsRef.current.clear();
      for (const stream of streamsRef.current.values()) stream.getTracks().forEach((track) => track.stop());
      streamsRef.current.clear();
    };
  }, [makePeerConnection, sendSignal]);

  useEffect(() => {
    let lastSent = 0;
    const handlePointer = (event: MouseEvent) => {
      const now = Date.now();
      if (now - lastSent < 80) return;
      lastSent = now;
      send({ type: "cursor", x: event.clientX / Math.max(1, window.innerWidth), y: event.clientY / Math.max(1, window.innerHeight) });
    };
    window.addEventListener("mousemove", handlePointer, { passive: true });
    return () => window.removeEventListener("mousemove", handlePointer);
  }, [send]);

  const sendChat = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    send({ type: "chat", text, roomId: "global", deviceId: getDeviceId() });
    setDraft("");
  };

  const shareScreen = async (user: Peer) => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const pc = makePeerConnection(user.userId);
      streamsRef.current.set(user.userId, stream);
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
        track.addEventListener("ended", () => {
          pc.close();
          pcsRef.current.delete(user.userId);
          streamsRef.current.get(user.userId)?.getTracks().forEach((item) => item.stop());
          streamsRef.current.delete(user.userId);
          setSharingWith(null);
        }, { once: true });
      });
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendSignal(user.userId, { type: "offer", description: offer });
      setSharingWith(user.userId);
    } catch (error) {
      console.warn("Screen sharing was cancelled or unavailable", error);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-[100] select-none">
      {Object.entries(remoteStreams).map(([userId, stream]) => (
        <RemoteScreen key={userId} stream={stream} name={peers.find((peer) => peer.userId === userId)?.displayName ?? "Collaborator"} />
      ))}
      {open && (
        <section className="mb-3 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-card/95 text-card-foreground shadow-2xl backdrop-blur-xl">
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold"><Users className="size-4" /> Collaboration <span className={connected ? "size-2 rounded-full bg-emerald-500" : "size-2 rounded-full bg-destructive"} /></div>
            <button type="button" aria-label="Close collaboration" onClick={() => setOpen(false)} className="rounded-lg p-1.5 hover:bg-muted"><X className="size-4" /></button>
          </header>
          <div className="flex border-b border-border p-1">
            <button type="button" onClick={() => setTab("people")} className={`flex-1 rounded-lg px-3 py-2 text-sm ${tab === "people" ? "bg-muted font-semibold" : "text-muted-foreground"}`}>People ({peers.length})</button>
            <button type="button" onClick={() => setTab("chat")} className={`flex-1 rounded-lg px-3 py-2 text-sm ${tab === "chat" ? "bg-muted font-semibold" : "text-muted-foreground"}`}>Chat</button>
          </div>
          {tab === "people" ? (
            <div className="max-h-64 space-y-2 overflow-y-auto p-3">
              {peers.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No other users are connected.</p>}
              {peers.map((peer, index) => (
                <div key={`${peer.userId}-${index}`} className="flex items-center gap-3 rounded-xl border border-border/70 p-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold">{peer.displayName.slice(0, 1).toUpperCase()}</div>
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{peer.displayName}</p><p className="text-xs capitalize text-muted-foreground">{peer.role}</p></div>
                  <button type="button" onClick={() => void shareScreen(peer)} disabled={sharingWith === peer.userId} title="Share your screen" className="rounded-lg border border-border p-2 hover:bg-muted disabled:opacity-50"><MonitorUp className="size-4" /></button>
                </div>
              ))}
              {sharingWith && <p className="text-xs text-muted-foreground">Sharing your screen with {peers.find((peer) => peer.userId === sharingWith)?.displayName ?? "user"}.</p>}
              <p className="px-1 text-xs text-muted-foreground">Screen sharing starts only after you select a user and approve the browser prompt.</p>
            </div>
          ) : (
            <div className="flex h-72 flex-col">
              <div className="flex-1 space-y-2 overflow-y-auto p-3">
                {messages.map((message) => <div key={message.id} className="rounded-xl bg-muted/70 px-3 py-2"><p className="text-xs font-semibold">{message.displayName}</p><p className="break-words text-sm">{message.text}</p></div>)}
                {messages.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No messages yet.</p>}
              </div>
              <form onSubmit={sendChat} className="flex gap-2 border-t border-border p-3">
                <input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={2000} placeholder="Message everyone…" className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
                <button type="submit" disabled={!draft.trim() || !connected} className="rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">Send</button>
              </form>
            </div>
          )}
        </section>
      )}
      <button type="button" onClick={() => setOpen((value) => !value)} className="ml-auto flex items-center gap-2 rounded-full border border-border bg-card px-4 py-3 text-sm font-semibold text-card-foreground shadow-xl hover:bg-muted">
        <MessageCircle className="size-4" /> Collaborate <span className={connected ? "size-2 rounded-full bg-emerald-500" : "size-2 rounded-full bg-destructive"} />
      </button>
    </div>
  );
}

function RemoteScreen({ stream, name }: { stream: MediaStream; name: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);
  return (
    <div className="mb-3 w-[min(28rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
      <div className="px-3 py-2 text-xs font-semibold">{name}'s screen</div>
      <video ref={videoRef} autoPlay playsInline className="max-h-64 w-full bg-black object-contain" />
    </div>
  );
}
