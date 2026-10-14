const HOSTNAME_CACHE_KEY = "utoolity.detected-hostname";
let hostnameRequest: Promise<string> | undefined;

type DeviceHostnameResponse = {
  hostname?: unknown;
};

export async function getDeviceHostname(): Promise<string> {
  if (typeof window !== "undefined") {
    const cached = window.localStorage.getItem(HOSTNAME_CACHE_KEY)?.trim();
    if (cached) return cached;
  }

  if (!hostnameRequest) {
    hostnameRequest = (async () => {
      const response = await fetch("/internal/device-hostname", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch device hostname: ${response.status}`);
      }

      const data = (await response.json()) as DeviceHostnameResponse;
      const detectedHostname =
        typeof data.hostname === "string" ? data.hostname.trim() : "";

      if (!detectedHostname) {
        throw new Error("The device-hostname endpoint returned an empty hostname.");
      }

      if (typeof window !== "undefined") {
        window.localStorage.setItem(HOSTNAME_CACHE_KEY, detectedHostname);
      }

      return detectedHostname;
    })().catch((error: unknown) => {
      hostnameRequest = undefined;
      throw error;
    });
  }

  return hostnameRequest;
}
