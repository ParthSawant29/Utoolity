
import type { FastifyInstance, FastifyRequest } from "fastify";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

type InternUser = {
  id: string;
  hostname: string;
  displayName: string;
  password: string;
  macId: string;
  role: "intern";
  preferences?: Record<string, string>;
};

type UsersFile = {
  users: InternUser[];
};

type CredentialsBody = {
  hostname?: string;
  password?: string;
};

type PublicUser = Pick<
  InternUser,
  "id" | "hostname" | "displayName" | "role"
>;

type AuthSession = {
  userId?: string;
  role?: "intern";
  lastActivityAt?: number;
  save(callback: (error?: Error) => void): void;
  destroy(callback: (error?: Error) => void): void;
};
type WorkspaceState = Record<string, unknown>;
type SessionRecord = {
  userId: string;
  hostname: string;
  displayName: string;
  deviceId: string;
  role: "intern";
  active: boolean;
  activeApps: unknown[];
  lastActivityAt: number;
  updatedAt: number;
};

const preferenceKeys = new Set([
  "utoolity.wallpaper",
  "utoolity.lockscreen",
  "utoolity.animations",
  "utoolity.grain",
  "utoolity.theme",
  "utoolity.icon-size",
]);
const defaultPreferences: Record<string, string> = {
  "utoolity.wallpaper": "default.jpg",
  "utoolity.icon-size": "large",
};

function getSession(request: FastifyRequest): AuthSession {
  return (request as FastifyRequest & { session: AuthSession }).session;
}

async function readSessions(): Promise<Record<string, SessionRecord>> {
  const raw = JSON.parse(await readFile(sessionsFilePath, "utf8")) as {
    sessions?: Record<string, SessionRecord>;
  };
  return raw.sessions ?? {};
}

async function writeSessions(sessions: Record<string, SessionRecord>): Promise<void> {
  await writeFile(
    sessionsFilePath,
    `${JSON.stringify({ sessions }, null, 2)}\n`,
    "utf8",
  );
}

let sessionUpdateQueue: Promise<void> = Promise.resolve();

function getDeviceId(request: FastifyRequest, fallback: string): string {
  const candidate = request.headers["x-utoolity-device-id"];
  if (typeof candidate === "string" && /^[a-zA-Z0-9._:-]{8,128}$/.test(candidate)) {
    return candidate;
  }
  return fallback;
}

async function updateSessionRecord(
  user: InternUser,
  values: Pick<SessionRecord, "active" | "activeApps" | "lastActivityAt">,
  deviceId = user.macId,
): Promise<void> {
  const write = sessionUpdateQueue.then(async () => {
    const sessions = await readSessions();
    const now = Date.now();
    const recordKey = `${user.id}:${deviceId}`;
    delete sessions[user.id];
    sessions[recordKey] = {
      userId: user.id,
      hostname: user.hostname,
      displayName: user.displayName,
      deviceId,
      role: user.role,
      ...values,
      updatedAt: now,
    };
    await writeSessions(sessions);
  });
  sessionUpdateQueue = write.catch(() => undefined);
  await write;
}

const usersFilePath = fileURLToPath(
  new URL("../data/users.json", import.meta.url),
);
const workspacesFilePath = fileURLToPath(
  new URL("../data/workspaces.json", import.meta.url),
);
const sessionsFilePath = fileURLToPath(
  new URL("../data/sessions.json", import.meta.url),
);

async function readUsers(): Promise<InternUser[]> {
  const raw = await readFile(usersFilePath, "utf8");
  const parsed: unknown = JSON.parse(raw);

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("users" in parsed) ||
    !Array.isArray(parsed.users)
  ) {
    throw new Error("users.json must contain a users array.");
  }

  return parsed.users as InternUser[];
}

async function readWorkspaces(): Promise<Record<string, WorkspaceState>> {
  const raw = JSON.parse(await readFile(workspacesFilePath, "utf8")) as {
    workspaces?: Record<string, WorkspaceState>;
  };
  return raw.workspaces ?? {};
}

async function writeUsers(users: InternUser[]): Promise<void> {
  await writeFile(
    usersFilePath,
    `${JSON.stringify({ users }, null, 2)}\n`,
    "utf8",
  );
}

function publicUser(user: InternUser): PublicUser {
  return {
    id: user.id,
    hostname: user.hostname,
    displayName: user.displayName,
    role: user.role,
  };
}

function findByHostname(
  users: InternUser[],
  hostname: string,
): InternUser | undefined {
  const normalizedHostname = hostname.trim().toLowerCase();

  return users.find(
    (user) =>
      user.hostname.trim().toLowerCase() === normalizedHostname,
  );
}

function findById(
  users: InternUser[],
  id: string,
): InternUser | undefined {
  return users.find((user) => user.id === id);
}

function validCredentials(
  body: CredentialsBody | undefined,
): body is { hostname: string; password: string } {
  return (
    typeof body?.hostname === "string" &&
    body.hostname.trim().length > 0 &&
    body.hostname.length <= 255 &&
    typeof body.password === "string" &&
    body.password.length > 0 &&
    body.password.length <= 1024
  );
}

function saveSession(request: FastifyRequest): Promise<void> {
  return new Promise((resolve, reject) => {
    getSession(request).save((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function destroySession(request: FastifyRequest): Promise<void> {
  return new Promise((resolve, reject) => {
    getSession(request).destroy((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function establishSession(
  request: FastifyRequest,
  user: InternUser,
): Promise<void> {
  const session = getSession(request);
  session.userId = user.id;
  session.role = user.role;
  session.lastActivityAt = Date.now();
  await saveSession(request);
}

export default async function authRoutes(app: FastifyInstance) {
  app.get("/auth/workspace", async (request, reply) => {
    const userId = getSession(request).userId;
    if (!userId) return reply.code(401).send({ message: "Not authenticated." });
    const workspaces = await readWorkspaces();
    return { workspace: workspaces[userId] ?? {} };
  });

  app.put<{ Body: WorkspaceState }>("/auth/workspace", async (request, reply) => {
    const userId = getSession(request).userId;
    if (!userId) return reply.code(401).send({ message: "Not authenticated." });
    const users = await readUsers();
    const user = findById(users, userId);
    if (!user) return reply.code(401).send({ message: "Session user no longer exists." });
    const workspaces = await readWorkspaces();
    workspaces[userId] = request.body ?? {};
    await writeFile(workspacesFilePath, JSON.stringify({ workspaces }, null, 2));
    const activeApps = request.body && Array.isArray(request.body.openApps)
      ? request.body.openApps
      : [];
    const deviceId = getDeviceId(request, user.macId);
    const currentSessions = await readSessions();
    const existing = currentSessions[`${user.id}:${deviceId}`] ?? currentSessions[user.id];
    await updateSessionRecord(user, {
      active: true,
      activeApps: activeApps.length ? activeApps : existing?.activeApps ?? [],
      lastActivityAt: Date.now(),
    }, deviceId);
    return { success: true };
  });

  app.post("/auth/activity", async (request, reply) => {
    const session = getSession(request);
    if (!session.userId) {
      return reply.code(401).send({ message: "Not authenticated." });
    }
    session.lastActivityAt = Date.now();
    try {
      const users = await readUsers();
      const user = findById(users, session.userId);
      if (user) {
        const sessions = await readSessions();
        const deviceId = getDeviceId(request, user.macId);
        const existing = sessions[`${user.id}:${deviceId}`] ?? sessions[user.id];
        await updateSessionRecord(user, {
          active: true,
          activeApps: existing?.activeApps ?? [],
          lastActivityAt: session.lastActivityAt,
        }, deviceId);
      }
    } catch (error) {
      request.log.error(error, "Unable to persist session activity.");
    }
    await saveSession(request);
    return { success: true, lastActivityAt: session.lastActivityAt };
  });

  // POST /api/auth/login
  app.post<{ Body: CredentialsBody }>(
    "/auth/login",
    async (request, reply) => {
      if (!validCredentials(request.body)) {
        return reply.code(400).send({
          message: "A valid hostname and password are required.",
        });
      }

      try {
        const users = await readUsers();
        const user = findByHostname(users, request.body.hostname);

        if (!user || user.password !== request.body.password) {
          return reply.code(401).send({
            message: "Invalid hostname or password.",
          });
        }

        await establishSession(request, user);
        await updateSessionRecord(user, {
          active: true,
          activeApps: [],
          lastActivityAt: Date.now(),
        }, getDeviceId(request, user.macId));

        return {
          user: publicUser(user),
        };
      } catch (error) {
        request.log.error(error, "Login failed unexpectedly");

        return reply.code(500).send({
          message: "Unable to sign in right now.",
        });
      }
    },
  );

  // POST /api/auth/logout
  app.post("/auth/logout", async (request, reply) => {
    try {
      const session = getSession(request);
      if (session.userId) {
        const users = await readUsers();
        const user = findById(users, session.userId);
        if (user) {
          await updateSessionRecord(user, {
            active: false,
            activeApps: [],
            lastActivityAt: Date.now(),
          }, getDeviceId(request, user.macId));
        }
      }
      await destroySession(request);
      reply.header("Set-Cookie", "sessionId=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");

      return { success: true };
    } catch (error) {
      request.log.error(error, "Logout failed");

      return reply.code(500).send({
        message: "Unable to sign out right now.",
      });
    }
  });

  // GET /api/auth/me
  app.get("/auth/me", async (request, reply) => {
    const userId = getSession(request).userId;

    if (!userId) {
      return reply.code(401).send({
        message: "Not authenticated.",
      });
    }

    try {
      const users = await readUsers();
      const user = findById(users, userId);

      if (!user) {
        await destroySession(request);
        reply.header(
          "Set-Cookie",
          "sessionId=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
        );

        return reply.code(401).send({
          message: "Session user no longer exists.",
        });

      }

      return {
        user: publicUser(user),
      };
    } catch (error) {
      request.log.error(error, "Unable to load current user");

      return reply.code(500).send({
        message: "Unable to load the current user.",
      });
    }
  });

  // Keep preference routes at registration time, not inside /auth/me's catch
  // handler (which made them unreachable and left the routes unregistered).
  app.get("/auth/preferences", async (request, reply) => {
    const userId = getSession(request).userId;
    if (!userId) {
      return reply.code(401).send({ message: "Not authenticated." });
    }

    try {
      const user = findById(await readUsers(), userId);
      if (!user) {
        return reply.code(401).send({ message: "Session user no longer exists." });
      }
      return {
        preferences: {
          ...defaultPreferences,
          ...(user.preferences ?? {}),
        },
      };
    } catch (error) {
      request.log.error(error, "Unable to load user preferences");
      return reply.code(500).send({ message: "Unable to load preferences." });
    }
  });

  app.patch<{ Body: Record<string, unknown> }>(
    "/auth/preferences",
    async (request, reply) => {
      const userId = getSession(request).userId;
      if (!userId) {
        return reply.code(401).send({ message: "Not authenticated." });
      }

      const entries = Object.entries(request.body ?? {});
      if (
        entries.length === 0 ||
        entries.some(
          ([key, value]) =>
            !preferenceKeys.has(key) ||
            typeof value !== "string" ||
            value.length > 100,
        )
      ) {
        return reply.code(400).send({ message: "Invalid preference payload." });
      }

      try {
        const users = await readUsers();
        const user = findById(users, userId);
        if (!user) {
          return reply.code(401).send({ message: "Session user no longer exists." });
        }

        user.preferences = {
          ...defaultPreferences,
          ...(user.preferences ?? {}),
        };
        for (const [key, value] of entries) {
          user.preferences[key] = value as string;
        }
        await writeUsers(users);
        return { preferences: user.preferences };
      } catch (error) {
        request.log.error(error, "Unable to save user preferences");
        return reply.code(500).send({ message: "Unable to save preferences." });
      }
    },
  );

  // WebSocket /api/auth/socket: one authenticated channel for device activity.
  app.get("/auth/socket", { websocket: true }, (socket, request) => {
    const userId = getSession(request).userId;
    if (!userId) {
      socket.close(1008, "Authentication required");
      return;
    }

    let deviceId = "pending-device";
    let inactivityTimer: ReturnType<typeof setTimeout> | undefined;

    const persistActivity = async (active: boolean) => {
      try {
        const user = findById(await readUsers(), userId);
        if (!user) {
          socket.close(1008, "Session user no longer exists");
          return;
        }
        const sessions = await readSessions();
        const existing = sessions[`${user.id}:${deviceId}`] ?? sessions[user.id];
        await updateSessionRecord(user, {
          active,
          activeApps: existing?.activeApps ?? [],
          lastActivityAt: active ? Date.now() : existing?.lastActivityAt ?? Date.now(),
        }, deviceId === "pending-device" ? user.macId : deviceId);
      } catch (error) {
        request.log.error(error, "Unable to persist WebSocket activity");
      }
    };

    const resetInactivityTimer = () => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        void persistActivity(false);
      }, 5 * 60 * 1000);
    };

    socket.on("message", (raw: Buffer | ArrayBuffer | Buffer[]) => {
      let message: { type?: unknown; deviceId?: unknown };
      try {
        message = JSON.parse(raw.toString()) as { type?: unknown; deviceId?: unknown };
      } catch {
        return;
      }

      if (typeof message.deviceId === "string" && /^[a-zA-Z0-9._:-]{8,128}$/.test(message.deviceId)) {
        deviceId = message.deviceId;
      }
      if (message.type !== "activity" || deviceId === "pending-device") return;

      resetInactivityTimer();
      void persistActivity(true);
    });

    socket.on("close", () => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      void persistActivity(false);
    });
    socket.on("error", (error: Error) => {
      request.log.warn({ err: error }, "Device activity WebSocket error");
    });

    socket.send(JSON.stringify({ type: "connected" }));
  });

  // Resolve the lock-screen identity from the persistent device ID first.
  // A previously assigned hostname remains supported for existing installs.
  app.get<{
    Querystring: { hostname?: string };
  }>("/lockscreen/me", async (request, reply) => {
    const hostname = request.query.hostname?.trim();

    if (hostname && hostname.length > 255) {
      return reply.code(400).send({
        message: "Invalid hostname.",
      });
    }

    try {
      const users = await readUsers();
      let user = hostname ? findByHostname(users, hostname) : undefined;

      if (!user) {
        const deviceId = getDeviceId(request, "");
        if (deviceId) {
          const sessions = await readSessions();
          const deviceSession = Object.values(sessions).find(
            (session) => session.deviceId === deviceId,
          );
          if (deviceSession) {
            user = findById(users, deviceSession.userId);
          }
        }
      }

      if (!user && hostname) {
        return reply.code(404).send({
          message: "No account is assigned to this hostname.",
        });
      }

      if (!user) {
        return reply.code(404).send({
          message: "This device has not been assigned to an account yet.",
        });
      }

      return {
        user: {
          ...publicUser(user),
          locked: true,
        },
      };
    } catch (error) {
      request.log.error(error, "Unable to load lockscreen profile");

      return reply.code(500).send({
        message: "Unable to load the device profile.",
      });
    }
  });

  // POST /api/lockscreen/unlock
  app.post<{ Body: CredentialsBody }>(
    "/lockscreen/unlock",
    async (request, reply) => {
      if (!validCredentials(request.body)) {
        return reply.code(400).send({
          message: "A valid hostname and password are required.",
        });
      }

      try {
        const users = await readUsers();
        const user = findByHostname(users, request.body.hostname);

        if (!user || user.password !== request.body.password) {
          return reply.code(401).send({
            message: "Incorrect password.",
          });
        }

        await establishSession(request, user);
        await updateSessionRecord(user, {
          active: true,
          activeApps: [],
          lastActivityAt: Date.now(),
        }, getDeviceId(request, user.macId));

        return {
          success: true,
          user: publicUser(user),
        };
      } catch (error) {
        request.log.error(error, "Lockscreen authentication failed");

        return reply.code(500).send({
          message: "Unable to verify the password.",
        });
      }
    },
  );
}
