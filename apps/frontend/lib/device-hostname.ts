type DeviceHostnameResponse = {
  hostname?: unknown;
};

export async function getDeviceHostname(): Promise<string> {
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

  return detectedHostname;
}
