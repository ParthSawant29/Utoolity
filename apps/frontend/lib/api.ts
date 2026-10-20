const API_URL = "";

export function getDeviceId(): string | undefined {
  if (typeof window === "undefined") return undefined;

  const key = "utoolity.device-id";
  const stored = window.localStorage.getItem(key);

  if (stored) return stored;

  const id =
    typeof window.crypto?.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  window.localStorage.setItem(key, id);

  return id;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function performApi<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const hasBody = options.body != null;

  const isFormData =
    typeof FormData !== "undefined" && options.body instanceof FormData;

  const headers = new Headers(options.headers);
  const deviceId = getDeviceId();

  if (deviceId) {
    headers.set("X-Utoolity-Device-Id", deviceId);
  }

  if (isFormData) {
    headers.delete("Content-Type");
  } else if (hasBody) {
    headers.set("Content-Type", "application/json");
  } else {
    headers.delete("Content-Type");
  }

  let response: Response | undefined;
  let lastError: unknown;
  let proxyUnavailable = false;

  const baseUrl = API_URL.replace(/\/+$/, "");
  const normalizedPath = path.replace(/^\/+/, "");
  const url = `${baseUrl}/${normalizedPath}`;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const nextResponse = await fetch(url, {
        ...options,
        headers,
        credentials: "include",
        cache: "no-store",
      });

      if ([500, 502, 503, 504].includes(nextResponse.status)) {
        const upstreamError = await nextResponse.clone().text();

        proxyUnavailable =
          /ECONNREFUSED|Failed to proxy|connect\s+ECONNREFUSED|socket hang up/i.test(
            upstreamError,
          );

        if (proxyUnavailable && attempt < 4) {
          await new Promise((resolve) =>
            setTimeout(resolve, 500 * (attempt + 1)),
          );
          continue;
        }
      }

      response = nextResponse;
      break;
    } catch (error) {
      lastError = error;

      if (attempt === 4) {
        throw new Error(
          `Unable to reach the backend at ${API_URL || "the configured API proxy"}.`,
          { cause: error },
        );
      }

      await new Promise((resolve) =>
        setTimeout(resolve, 300 * (attempt + 1)),
      );
    }
  }

  if (!response) {
    if (proxyUnavailable) {
      throw new Error(
        "The backend is temporarily unavailable. Retrying did not restore the connection.",
      );
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Network request failed.");
  }

  const contentType = response.headers.get("content-type");
  const text = await response.text();

  let body: unknown = text;

  if (text && contentType?.includes("application/json")) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    // A protected API returning 401 means the server-side session is gone.
    // Notify the desktop shell so cached profile UI cannot masquerade as a
    // live session. Network errors do not reach this branch and remain offline-safe.
    if (
      response.status === 401 &&
      !/^\\/api\\/(auth\\/(login|logout|me|socket)|lockscreen\\/(unlock|me))(?:[/?]|$)/.test(path)
    ) {
      window.dispatchEvent(new CustomEvent("utoolity:session-invalid", {
        detail: { path, status: response.status },
      }));
    }

    const message =
      typeof body === "object" &&
      body !== null &&
      "message" in body
        ? String(body.message)
        : typeof body === "string" && body.trim()
          ? body
          : `Request failed (${response.status}).`;

    throw new ApiError(message, response.status);
  }

  if (!text) {
    return undefined as T;
  }

  return body as T;
}

const pendingGetRequests = new Map<string, Promise<unknown>>();
const cachedGetResponses = new Map<string, { expiresAt: number; value: unknown }>();
const PREFERENCE_CACHE_MS = 3_000;

export function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  if (method !== "GET") {
    if (path === "/api/auth/preferences" && method === "PATCH") {
      cachedGetResponses.delete("/api/auth/preferences");
    }
    if (["/api/auth/login", "/api/auth/logout", "/api/lockscreen/unlock"].includes(path)) {
      cachedGetResponses.clear();
    }
    return performApi<T>(path, options);
  }

  // Preference consumers in the desktop and settings panels share the same
  // small cache, avoiding a burst of identical requests during initial mount.
  if (path === "/api/auth/preferences") {
    const cached = cachedGetResponses.get(path);
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value as T);
    cachedGetResponses.delete(path);
  }

  const pending = pendingGetRequests.get(path);
  if (pending) return pending as Promise<T>;

  const request = performApi<T>(path, options)
    .then((value) => {
      if (path === "/api/auth/preferences") {
        cachedGetResponses.set(path, { expiresAt: Date.now() + PREFERENCE_CACHE_MS, value });
      }
      return value;
    })
    .finally(() => {
      if (pendingGetRequests.get(path) === request) pendingGetRequests.delete(path);
    });
  pendingGetRequests.set(path, request);
  return request;
}

export { API_URL };