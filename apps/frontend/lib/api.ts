
const API_URL = "";

export function getDeviceId(): string | undefined {
  if (typeof window === "undefined") return undefined;

  const key = "utoolity.device-id";
  const stored = window.localStorage.getItem(key);
  if (stored) return stored;

  const id = typeof window.crypto?.randomUUID === "function"
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

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const hasBody = options.body != null;

  const isFormData =
    typeof FormData !== "undefined" &&
    options.body instanceof FormData;

  const headers = new Headers(options.headers);
  const deviceId = getDeviceId();
  if (deviceId) headers.set("X-Utoolity-Device-Id", deviceId);

  if (isFormData) {
    // Let the browser set the multipart boundary.
    headers.delete("Content-Type");
  } else if (hasBody) {
    headers.set("Content-Type", "application/json");
  } else {
    headers.delete("Content-Type");
  }

  let response: Response | undefined;
  let lastError: unknown;
  let proxyUnavailable = false;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const nextResponse = await fetch(
        `${API_URL.replace(/\\/+$/, "")}/${path.replace(/^\\/+/, "")}`,
        {
          ...options,
          headers,
          credentials: "include",
          cache: "no-store",
        },
      );

      // Next.js reports a refused upstream connection as an HTTP error response,
      // not as a rejected fetch. Retry only recognizable proxy-connect failures.
      if ([500, 502, 503, 504].includes(nextResponse.status)) {
        const upstreamError = await nextResponse.clone().text();
        proxyUnavailable = /ECONNREFUSED|Failed to proxy|connect\s+ECONNREFUSED|socket hang up/i.test(upstreamError);
        if (proxyUnavailable && attempt < 4) {
          await new Promise((resolve) => window.setTimeout(resolve, 500 * (attempt + 1)));
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
      await new Promise((resolve) => window.setTimeout(resolve, 300 * (attempt + 1)));
    }
  }

  if (!response) {
    if (proxyUnavailable) {
      throw new Error("The backend is temporarily unavailable. Retrying did not restore the connection.");
    }
    throw lastError instanceof Error ? lastError : new Error("Network request failed.");
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

export { API_URL };
