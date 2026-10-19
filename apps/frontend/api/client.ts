import axios from "axios";
import { getDeviceId } from "../lib/api";

export const api = axios.create({
  baseURL: "/api",
  headers: {
    "Content-Type": "application/json",
  },
});

api.interceptors.request.use((config) => {
  const deviceId = getDeviceId();
  if (deviceId) config.headers.set("X-Utoolity-Device-Id", deviceId);
  return config;
});
