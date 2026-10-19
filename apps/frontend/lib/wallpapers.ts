export type Wallpaper = {
  file: string;
  name: string;
  url: string;
  darkUrl?: string;
  lightUrl?: string;
};

const CACHE_KEY = "utoolity.wallpaper-catalog";
const CACHE_VERSION = 1;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type CachedCatalog = {
  version: number;
  savedAt: number;
  wallpapers: Wallpaper[];
};

let cachedWallpapers: Wallpaper[] | undefined;
let pendingRequest: Promise<Wallpaper[]> | undefined;

function readCachedCatalog(allowStale = false): Wallpaper[] | undefined {
  if (typeof window === "undefined") return undefined;

  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return undefined;

    const cached = JSON.parse(raw) as CachedCatalog;
    if (
      cached.version !== CACHE_VERSION ||
      !Array.isArray(cached.wallpapers) ||
      !Number.isFinite(cached.savedAt)
    ) {
      return undefined;
    }

    if (!allowStale && Date.now() - cached.savedAt > CACHE_TTL_MS) {
      return undefined;
    }

    return cached.wallpapers;
  } catch {
    return undefined;
  }
}

function requestCatalog(): Promise<Wallpaper[]> {
  if (pendingRequest) return pendingRequest;

  pendingRequest = (async () => {
    const response = await fetch("/api/wallpapers");
    if (!response.ok) {
      throw new Error(`Unable to load wallpaper catalog (${response.status}).`);
    }

    const payload = (await response.json()) as { wallpapers?: Wallpaper[] };
    const wallpapers = Array.isArray(payload.wallpapers) ? payload.wallpapers : [];
    cachedWallpapers = wallpapers;

    if (typeof window !== "undefined") {
      try {
        const cache: CachedCatalog = {
          version: CACHE_VERSION,
          savedAt: Date.now(),
          wallpapers,
        };
        window.localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
      } catch {
        // Keep the in-memory cache when browser storage is unavailable.
      }
    }

    return wallpapers;
  })().finally(() => {
    pendingRequest = undefined;
  });

  return pendingRequest;
}

export async function getWallpapers(options: { refresh?: boolean } = {}): Promise<Wallpaper[]> {
  if (!options.refresh && cachedWallpapers) return cachedWallpapers;

  if (!options.refresh) {
    const persisted = readCachedCatalog();
    if (persisted) {
      cachedWallpapers = persisted;
      return persisted;
    }

    // Serve the last known catalog immediately when it is stale. Refresh it in
    // the background; a temporary backend outage must not blank the wallpaper UI.
    const stale = readCachedCatalog(true);
    if (stale) {
      cachedWallpapers = stale;
      void requestCatalog().catch(() => undefined);
      return stale;
    }
  }

  return requestCatalog();
}
