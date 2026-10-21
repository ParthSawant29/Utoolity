import axios from "axios";

export const api = axios.create({
  baseURL: "/api",
  headers: {
    "Content-Type": "application/json",
  },
});

// Authenticated app requests use the HttpOnly session cookie. Do not attach
// the lock-screen's cached device identifier to every app request.
