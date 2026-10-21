"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  LockKeyhole,
  Maximize,
  ShieldCheck,
  WifiOff,
} from "lucide-react";
import { api, ApiError } from "../../lib/api";
import { useClock } from "../shared/useClock";
type LockProfile = {
  id: string;
  hostname: string;
  displayName: string;
  locked: boolean;
};
type LockProfileResponse = {
  user?: {
    id: string;
    hostname: string;
    displayName: string;
    role: "intern" | "admin";
  };
  requiresDeviceId?: boolean;
};
type UnlockResponse = {
  success: boolean;
  user?: {
    id: string;
    hostname: string;
    displayName: string;
    role: "intern" | "admin";
  };
};
type LockcardProps = {
  socketDisconnected: boolean;
  initialAuthenticated?: boolean;
  initialState?: LockscreenState;
  onUnlock?: () => void;
};
type LockscreenState = "sleep" | "locked";
const HOSTNAME_STORAGE_KEY = "utoolity.hostname";
const INACTIVITY_TIMEOUT_MS = 60_000;
function getGreeting(date: Date): string {
  const hour = date.getHours();
  if (hour >= 22 || hour < 5) return "STILL UP?";
  if (hour < 9) return "EARLY BIRD?";
  if (hour < 12) return "GOOD MORNING";
  if (hour < 14) return "LUNCH O'CLOCK?";
  if (hour < 17) return "GOOD AFTERNOON";
  if (hour < 20) return "GOOD EVENING";
  return "CALLING IT A DAY?";
}

function Lockcard({
  socketDisconnected,
  initialAuthenticated = false,
  initialState = "locked",
  onUnlock,
}: LockcardProps) {
  const cardRef = useRef<HTMLElement>(null);
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const now = useClock();
  const [profile, setProfile] = useState<LockProfile | null>(null);
  const [hostname, setHostname] = useState("");
  const [deviceIdInput, setDeviceIdInput] = useState("");
  const [password, setPassword] = useState("");
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [authenticated, setAuthenticated] = useState<boolean | null>(
    initialAuthenticated,
  );
  const [lockscreenState, setLockscreenState] =
    useState<LockscreenState>(initialState);
  const [leaving, setLeaving] = useState(false);
  const clearInactivityTimer = useCallback(() => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = undefined;
    }
  }, []);
  const relock = useCallback(() => {
    clearInactivityTimer();
    setPassword("");
    setError("");
    setProfile((current) =>
      current ? { ...current, locked: true } : current,
    );
  }, [clearInactivityTimer]);
  const startInactivityTimer = useCallback(() => {
    clearInactivityTimer();
    inactivityTimerRef.current = setTimeout(relock, INACTIVITY_TIMEOUT_MS);
  }, [clearInactivityTimer, relock]);
  const leaveLockscreen = useCallback(() => {
    if (leaving) return;
    setLeaving(true);
    transitionTimerRef.current = setTimeout(() => {
      onUnlock?.();
    }, 350);
  }, [leaving, onUnlock]);
  useEffect(() => {
    let active = true;

    async function loadProfile() {
      const hasAuthenticatedSession = initialAuthenticated;

      // Home already verifies /api/auth/me before rendering this lock screen.
      // Avoid issuing the same unauthenticated request a second time here.

      if (!active) return;
      setAuthenticated(hasAuthenticatedSession);
      setLockscreenState(
        hasAuthenticatedSession && initialState === "sleep" ? "sleep" : "locked",
      );

      const savedHostname = window.localStorage
        .getItem(HOSTNAME_STORAGE_KEY)
        ?.trim();
      const configuredHostname = savedHostname || "";

      setHostname(configuredHostname);
      // Cached profile is a display hint only. Use it immediately to avoid
      // flashing Guest, then refresh the assignment from the backend.
      const cachedProfileRaw = window.localStorage.getItem("utoolity.cached-user");
      if (cachedProfileRaw) {
        try {
          const cached = JSON.parse(cachedProfileRaw) as LockProfileResponse["user"];
          if (cached?.id && cached.hostname && cached.displayName) {
            setProfile({ ...cached, locked: true });
            setHostname(cached.hostname);
          }
        } catch {
          window.localStorage.removeItem("utoolity.cached-user");
        }
      }
      try {
        // api() sends the stable device ID. The backend remains authoritative.
        let resolvedUser: LockProfileResponse["user"];
        const profilePath = configuredHostname
          ? `/api/lockscreen/me?hostname=${encodeURIComponent(configuredHostname)}`
          : "/api/lockscreen/me";
        const response = await api<LockProfileResponse>(profilePath);
        resolvedUser = response.user;
        if (!active) return;
        if (!resolvedUser && response.requiresDeviceId) {
          setProfile(null);
          setHostname("");
          setDeviceIdInput("");
          setError("");
          return;
        }
        if (!resolvedUser) throw new Error("The backend returned an empty profile.");

        window.localStorage.setItem("utoolity.cached-user", JSON.stringify(resolvedUser));
        window.localStorage.setItem("utoolity.authenticated-user-id", resolvedUser.id);
        window.localStorage.setItem(HOSTNAME_STORAGE_KEY, resolvedUser.hostname);
        setProfile({ ...resolvedUser, locked: true });
        setHostname(resolvedUser.hostname);
        setError("");
      } catch (cause) {
        if (!active) return;
        console.warn("Lock-screen profile lookup failed; preserving cached profile if available.", cause);
        // Never turn a transport/server error into a fake Guest assignment.
        // Guest is shown only when the backend explicitly resolves Guest.
        setProfile((current) => current ?? null);
        setError("Unable to verify this device profile. Check the backend connection.");
      } finally {
        if (active) setLoadingProfile(false);
      }
    }

    void loadProfile();
    return () => {
      active = false;
      clearInactivityTimer();
      if (transitionTimerRef.current) {
        clearTimeout(transitionTimerRef.current);
      }
    };
  }, [clearInactivityTimer, initialAuthenticated, initialState]);
  useEffect(() => {
    const syncShellState = (event: Event) => {
      const state = (event as CustomEvent<LockscreenState>).detail;
      if (state !== "sleep" && state !== "locked") return;
      setLockscreenState(state);
      setAuthenticated(state === "sleep");
      setLeaving(false);
      setPassword("");
      if (state === "locked") {
        setProfile((current) =>
          current ? { ...current, locked: true } : current,
        );
      }
    };
    window.addEventListener("utoolity:shell-state-changed", syncShellState);
    return () =>
      window.removeEventListener("utoolity:shell-state-changed", syncShellState);
  }, []);
  useEffect(() => {
    setLockscreenState(initialState);
    setAuthenticated(initialAuthenticated);
    setLeaving(false);
    setPassword("");
    if (initialState === "locked") {
      setProfile((current) =>
        current ? { ...current, locked: true } : current,
      );
    }
  }, [initialAuthenticated, initialState]);
  useEffect(() => {
    if (!profile || authenticated !== true || lockscreenState !== "sleep") {
      return;
    }
    const wakeToDesktop = () => leaveLockscreen();
    window.addEventListener("pointerdown", wakeToDesktop, { passive: true });
    window.addEventListener("keydown", wakeToDesktop);
    return () => {
      window.removeEventListener("pointerdown", wakeToDesktop);
      window.removeEventListener("keydown", wakeToDesktop);
    };
  }, [authenticated, leaveLockscreen, lockscreenState, profile]);
  useEffect(() => {
    if (!profile || lockscreenState !== "locked") return;
    const activityEvents = ["pointerdown", "keydown", "mousemove", "touchstart"];
    const handleActivity = () => startInactivityTimer();
    activityEvents.forEach((event) =>
      window.addEventListener(event, handleActivity, { passive: true }),
    );
    startInactivityTimer();
    return () => {
      activityEvents.forEach((event) =>
        window.removeEventListener(event, handleActivity),
      );
      clearInactivityTimer();
    };
  }, [clearInactivityTimer, lockscreenState, profile, startInactivityTimer]);
  const handleDeviceIdSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const enteredDeviceId = deviceIdInput.trim();
    if (!enteredDeviceId || checking || loadingProfile) return;
    setChecking(true);
    setError("");
    try {
      const response = await api<LockProfileResponse>(
        `/api/lockscreen/me?hostname=${encodeURIComponent(enteredDeviceId)}`,
      );
      if (!response.user) {
        setError("Device ID was not found. Check it with your administrator.");
        return;
      }
      window.localStorage.setItem(HOSTNAME_STORAGE_KEY, response.user.hostname);
      window.localStorage.setItem("utoolity.device-id", response.user.hostname);
      window.localStorage.setItem("utoolity.cached-user", JSON.stringify(response.user));
      window.localStorage.setItem("utoolity.authenticated-user-id", response.user.id);
      setHostname(response.user.hostname);
      setProfile({ ...response.user, locked: true });
      setDeviceIdInput("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to verify this device ID.");
    } finally {
      setChecking(false);
    }
  };
  const handleUnlock = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const assignedHostname = (hostname || profile?.hostname || "").trim();
    if (!assignedHostname || !password || checking || !profile) return;
    setChecking(true);
    setError("");
    try {
      const response = await api<UnlockResponse>("/api/lockscreen/unlock", {
        method: "POST",
        body: JSON.stringify({ hostname: assignedHostname, password }),
      });
      if (!response.success) {
        setError("Unable to unlock this device.");
        return;
      }
      const user = response.user ?? profile;
      setProfile({ ...user, locked: false });
      setHostname(user.hostname);
      window.localStorage.setItem("utoolity.authenticated-user-id", user.id);
      window.localStorage.setItem("utoolity.cached-user", JSON.stringify(user));
      window.localStorage.setItem("utoolity.authenticated", "true");
      window.localStorage.setItem(HOSTNAME_STORAGE_KEY, user.hostname);
      leaveLockscreen();
    } catch (cause) {
      if (!(cause instanceof ApiError && cause.status === 401)) {
        console.error("Lockscreen authentication failed:", cause);
      }
      setError(
        cause instanceof Error ? cause.message : "Authentication failed.",
      );
    } finally {
      setChecking(false);
      setPassword("");
    }
  };
  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        // Fullscreen the lock-screen shell so the wallpaper remains visible
        // inside the browser's top layer. The shell owns the wallpaper through
        // its CSS background; keep the desktop cursor overlay above the card.
        await cardRef.current?.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      setError("Fullscreen is not available.");
    }
  };
  useEffect(() => {
    const handleFullscreenChange = () =>
      setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);
  const isLocked = profile?.locked !== false;
  return (
    <section
      ref={cardRef}
      _aria-label_="Lock screen"
      className={`lockscreen-shell fixed inset-0 z-50 isolate flex h-dvh min-h-dvh w-full flex-col items-center justify-center overflow-hidden rounded-none bg-black text-foreground ${
        leaving ? "lockscreen-exit" : "lockscreen-enter"
      }`}
    >
      <button
        type="button"
        onClick={toggleFullscreen}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        _aria-label_={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        className="absolute top-5 right-5 z-20 rounded-full border border-white/20 bg-black/20 p-3 text-white/80 backdrop-blur-2xl transition hover:bg-black/35 hover:text-white"
      >
        <Maximize className="size-4" />
      </button>
      <div className="lockscreen-frost-panel relative z-10 flex w-full flex-col items-center px-5 py-8 text-center transition-all duration-300">
        <p className="text-xl font-bold tracking-[0.24em] text-white/80">
          {getGreeting(now)}
        </p>
        <time
          dateTime={now.toISOString()}
          className="mt-3 bg-linear-to-b from-primary to-black bg-clip-text font-mono text-[clamp(1rem,16vw,11.5rem)] leading-none font-black tracking-[-0.08em] text-transparent tabular-nums"
        >
          {now.toLocaleTimeString(undefined, {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          })}
        </time>
        <p className="mt-5 text-base font-semibold text-white/80 sm:text-xl">
          {now.toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </p>
        <div className="mt-12 flex w-full flex-col items-center">
          <div className="mb-4 flex size-20 items-center justify-center rounded-full border border-white/25 bg-black/15 shadow-lg backdrop-blur-sm">
            <LockKeyhole
              className={`size-8 text-white/90 transition-opacity duration-500 ${
                lockscreenState === "locked" ? "opacity-100" : "opacity-35"
              }`}
            />
          </div>
          <h1 className="max-w-full wrap-break-word text-xl font-bold text-white">
            {loadingProfile
              ? "Loading profile..."
              : profile?.displayName ?? "Assigned workstation"}
          </h1>
          {!loadingProfile && !profile ? (
            <form
              onSubmit={handleDeviceIdSubmit}
              className="mt-8 flex w-full max-w-sm flex-col items-center"
            >
              <p className="mb-4 text-sm font-medium tracking-wide text-white/80">
                Enter your assigned device ID
              </p>
              <input
                aria-label="Device ID"
                type="text"
                value={deviceIdInput}
                onChange={(event) => setDeviceIdInput(event.target.value)}
                placeholder="e.g. wraith-os"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                disabled={checking}
                className="w-full rounded-2xl border border-white/20 bg-black/25 px-5 py-4 text-center text-lg text-white outline-none backdrop-blur-sm placeholder:text-white/45 focus:border-white/50 focus:ring-2 focus:ring-white/20 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={checking || !deviceIdInput.trim()}
                className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {checking ? "Checking..." : "Use this device"}
              </button>
              {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
            </form>
          ) : isLocked && lockscreenState === "locked" ? (
            <form
              onSubmit={handleUnlock}
              className="mt-8 flex w-full max-w-sm flex-col items-center"
            >
              <p className="mb-4 text-sm font-medium tracking-wide text-white/80">
                Sign in to unlock
              </p>
              <input
                _aria-label_="Password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                disabled={loadingProfile || checking}
                className="w-full rounded-2xl border border-white/20 bg-black/25 px-5 py-4 text-center font-mono text-3xl tracking-[0.45em] text-white outline-none backdrop-blur-sm placeholder:text-white/45 focus:border-white/50 focus:ring-2 focus:ring-white/20 disabled:opacity-50"
              />
              <button
                type="submit"
                _aria-label_="Unlock"
                disabled={loadingProfile || checking || !password || !profile?.hostname}
                className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ShieldCheck className="size-4" />
                {checking ? "Checking..." : "Unlock"}
              </button>
              {error && (
                <p role="alert" className="mt-3 text-sm text-destructive">
                  {error}
                </p>
              )}
            </form>
          ) : (
            <p className="mt-8 text-sm font-medium tracking-wide text-background/80">
              Tap or press any key to wake
            </p>
          )}
        </div>
      </div>
      {socketDisconnected && isLocked && (
        <div className="absolute bottom-5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-border/60 bg-card/50 px-3 py-2 text-xs text-muted-foreground backdrop-blur-xl">
          <WifiOff className="size-3.5" />
          Connection lost
        </div>
      )}
    </section>
  );
}
export default Lockcard;
