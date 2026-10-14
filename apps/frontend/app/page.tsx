"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Desktop from "@/components/desktop/Desktop";
import Lockcard from "@/components/lockscreen/LockcardEntry";
import { api, ApiError, getDeviceId } from "@/lib/api";
import Image from "next/image";

type ShellState = "checking" | "authenticated" | "sleep" | "locked";
const AUTHENTICATED_SESSION_KEY = "utoolity.authenticated";
const SHELL_STATE_KEY = "utoolity.shell-state";
const LAST_ACTIVITY_KEY = "utoolity.last-activity";
const SLEEP_STARTED_KEY = "utoolity.sleep-started";
const SLEEP_AFTER_MS = 5 * 60 * 1000;
const LOCK_AFTER_MS = 10 * 60 * 1000;

export default function Home() {
  const [shellState, setShellState] = useState<ShellState>("checking");
  const lastActivityRef = useRef(Date.now());
  const busyRef = useRef(false);
  const socketRef = useRef<WebSocket | null>(null);
  const socketRetryRef = useRef<number | undefined>(undefined);
  const lastSocketActivityRef = useRef(0);
  const shellStateRef = useRef(shellState);

  const sendSocketActivity = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    if (now - lastSocketActivityRef.current < 10_000) return;
    lastSocketActivityRef.current = now;
    socket.send(JSON.stringify({ type: "activity", deviceId: getDeviceId() }));
  }, []);

  const connectSocketRef = useRef<() => void>(() => undefined);
  const connectActivitySocket = useCallback(() => {
    const existing = socketRef.current;
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
      return;
    }
    if (socketRetryRef.current !== undefined) {
      window.clearTimeout(socketRetryRef.current);
      socketRetryRef.current = undefined;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.hostname}:4000/api/auth/socket`);
    socketRef.current = socket;

    socket.addEventListener("open", () => {
      if (socketRef.current !== socket) {
        socket.close();
        return;
      }
      lastSocketActivityRef.current = 0;
      sendSocketActivity();
    });
    socket.addEventListener("close", (event) => {
      if (socketRef.current === socket) socketRef.current = null;
      if (event.code !== 1008 && event.code !== 1000 && shellStateRef.current !== "checking") {
        socketRetryRef.current = window.setTimeout(() => {
          socketRetryRef.current = undefined;
          connectSocketRef.current();
        }, 3000);
      }
    });
    socket.addEventListener("error", () => socket.close(4000, "Connection error"));
  }, [sendSocketActivity]);
  connectSocketRef.current = connectActivitySocket;

  useEffect(() => {
    shellStateRef.current = shellState;
  }, [shellState]);

  useEffect(() => {
    if (shellState !== "checking") connectActivitySocket();
  }, [shellState, connectActivitySocket]);

  useEffect(() => {
    const activityEvents = ["pointerdown", "keydown", "mousemove", "touchstart"];
    activityEvents.forEach((event) =>
      window.addEventListener(event, sendSocketActivity, { passive: true }),
    );
    return () => {
      activityEvents.forEach((event) =>
        window.removeEventListener(event, sendSocketActivity),
      );
      socketRef.current?.close(1000, "Page closed");
      if (socketRetryRef.current !== undefined) window.clearTimeout(socketRetryRef.current);
    };
  }, [sendSocketActivity]);

  useEffect(() => {
    let active = true;

    async function verifySession() {
      const cachedAuthenticated =
        sessionStorage.getItem(AUTHENTICATED_SESSION_KEY) === "true";
      const cachedState = sessionStorage.getItem(SHELL_STATE_KEY);
      const cachedShellState: ShellState =
        cachedAuthenticated && (cachedState === "sleep" || cachedState === "locked")
          ? cachedState
          : cachedAuthenticated
            ? "authenticated"
            : "checking";

      if (active && cachedShellState !== "checking") {
        lastActivityRef.current = Number(
          sessionStorage.getItem(LAST_ACTIVITY_KEY) ?? Date.now(),
        );
        setShellState(cachedShellState);
      }

      try {
        await api("/api/auth/me");
        if (active) {
          sessionStorage.setItem(AUTHENTICATED_SESSION_KEY, "true");
          const savedState = sessionStorage.getItem(SHELL_STATE_KEY);
          const nextState: ShellState =
            savedState === "locked" || savedState === "sleep"
              ? savedState
              : "authenticated";
          sessionStorage.setItem(SHELL_STATE_KEY, nextState);
          setShellState(nextState);
          lastActivityRef.current = Number(
            sessionStorage.getItem(LAST_ACTIVITY_KEY) ?? Date.now(),
          );
        }
      } catch (error) {
        if (active) {
          if (
            !(error instanceof ApiError && error.status === 401) &&
            (cachedShellState === "authenticated" || cachedShellState === "sleep")
          ) {
            setShellState(cachedShellState);
          } else {
            sessionStorage.removeItem(AUTHENTICATED_SESSION_KEY);
            sessionStorage.removeItem(SHELL_STATE_KEY);
            setShellState("locked");
          }
        }
      }
    }

    void verifySession();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (shellState !== "authenticated") return;

    const recordActivity = () => {
      lastActivityRef.current = Date.now();
      sessionStorage.setItem(LAST_ACTIVITY_KEY, String(lastActivityRef.current));
      sendSocketActivity();
    };
    const activityEvents = ["pointerdown", "keydown", "mousemove", "touchstart"];
    activityEvents.forEach((event) =>
      window.addEventListener(event, recordActivity, { passive: true }),
    );

    const timer = window.setInterval(() => {
      if (busyRef.current || Date.now() - lastActivityRef.current < SLEEP_AFTER_MS) return;
      sessionStorage.setItem(SHELL_STATE_KEY, "sleep");
      sessionStorage.setItem(SLEEP_STARTED_KEY, String(Date.now()));
      setShellState("sleep");
    }, 1000);
    return () => {
      window.clearInterval(timer);
      activityEvents.forEach((event) =>
        window.removeEventListener(event, recordActivity),
      );
    };
  }, [shellState, sendSocketActivity]);

  useEffect(() => {
    const startWork = () => {
      busyRef.current = true;
      lastActivityRef.current = Date.now();
      sessionStorage.setItem(LAST_ACTIVITY_KEY, String(lastActivityRef.current));
    };
    const finishWork = () => {
      busyRef.current = false;
      lastActivityRef.current = Date.now();
      sessionStorage.setItem(LAST_ACTIVITY_KEY, String(lastActivityRef.current));
      sendSocketActivity();
    };
    window.addEventListener("utoolity:work-started", startWork);
    window.addEventListener("utoolity:work-finished", finishWork);
    return () => {
      window.removeEventListener("utoolity:work-started", startWork);
      window.removeEventListener("utoolity:work-finished", finishWork);
    };
  }, [sendSocketActivity]);

  useEffect(() => {
    const handleAuthExpired = () => {
      sessionStorage.removeItem(AUTHENTICATED_SESSION_KEY);
      sessionStorage.setItem(SHELL_STATE_KEY, "locked");
      setShellState("locked");
    };

    window.addEventListener("utoolity:auth-expired", handleAuthExpired);
    return () =>
      window.removeEventListener("utoolity:auth-expired", handleAuthExpired);
  }, []);

  useEffect(() => {
    if (shellState !== "sleep") return;

    const storedSleepStarted = Number(
      sessionStorage.getItem(SLEEP_STARTED_KEY),
    );
    const sleepStarted = Number.isFinite(storedSleepStarted) && storedSleepStarted > 0
      ? storedSleepStarted
      : Date.now();
    sessionStorage.setItem(SLEEP_STARTED_KEY, String(sleepStarted));
    const timer = window.setInterval(() => {
      if (Date.now() - sleepStarted < LOCK_AFTER_MS - SLEEP_AFTER_MS) return;
      sessionStorage.setItem(SHELL_STATE_KEY, "locked");
      setShellState("locked");
    }, 1000);

    return () => window.clearInterval(timer);
  }, [shellState]);

  useEffect(() => {
    document.documentElement.dataset.shellState = shellState;
    window.dispatchEvent(
      new CustomEvent("utoolity:shell-state-changed", {
        detail: shellState,
      }),
    );
  }, [shellState]);

  const enterSleep = () => {
    sessionStorage.setItem(SHELL_STATE_KEY, "sleep");
    sessionStorage.setItem(SLEEP_STARTED_KEY, String(Date.now()));
    setShellState("sleep");
  };

  const enterLocked = () => {
    sessionStorage.setItem(AUTHENTICATED_SESSION_KEY, "true");
    sessionStorage.setItem(SHELL_STATE_KEY, "locked");
    sessionStorage.removeItem(SLEEP_STARTED_KEY);
    setShellState("locked");
  };

  return (
    <div className="relative isolate h-dvh min-h-dvh overflow-hidden bg-background font-sans text-foreground">
      {shellState === "checking" ? (
        <div
          className="flex min-h-screen items-center justify-center bg-background"
          aria-label="Loading"
        >
          <Image
            src="/Logo.svg"
            alt=""
            width={96}
            height={96}
            priority
            className="h-24 w-24 brightness-0 invert opacity-90"
          />
        </div>
      ) : shellState === "authenticated" ? (
        <Desktop onSleep={enterSleep} onLock={enterLocked} />
      ) : (
        <Lockcard
          socketDisconnected={false}
          initialAuthenticated={shellState === "sleep"}
          initialState={shellState === "sleep" ? "sleep" : "locked"}
          onUnlock={() => {
            sessionStorage.setItem(AUTHENTICATED_SESSION_KEY, "true");
            sessionStorage.setItem(SHELL_STATE_KEY, "authenticated");
            sessionStorage.removeItem(SLEEP_STARTED_KEY);
            lastActivityRef.current = Date.now();
            sessionStorage.setItem(LAST_ACTIVITY_KEY, String(lastActivityRef.current));
            setShellState("authenticated");
          }}
        />
      )}
    </div>
  );
}