import axios from "axios";

export const api = axios.create({
  // Next.js proxies /api/* to BACKEND_URL, keeping browser requests same-origin.
  baseURL: "/api",
  headers: {
    "Content-Type": "application/json",
  },
});
