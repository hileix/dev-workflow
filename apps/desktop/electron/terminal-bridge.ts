import { randomUUID } from "crypto";
import { chmodSync, existsSync } from "fs";
import { createServer } from "http";
import { createRequire } from "module";
import { dirname, join } from "path";
import { spawn, type IPty } from "node-pty";
import { WebSocket, WebSocketServer } from "ws";

const MAX_BUFFER_CHARS = 200_000;
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

type TerminalControlMessage =
  | { type: "close" }
  | { cols: number; rows: number; type: "resize" };

interface TerminalSession {
  clients: Set<WebSocket>;
  closed: boolean;
  cwd: string;
  exitCode: number | null;
  id: string;
  output: string;
  pty: IPty;
  shell: string;
  idleTimer: NodeJS.Timeout | null;
}

interface StartTerminalBridgeResult {
  close: () => Promise<void>;
  getUrl: () => string;
}

const require = createRequire(import.meta.url);

const resolveShell = () => {
  if (process.platform === "win32") {
    return process.env.ComSpec || "cmd.exe";
  }
  return process.env.SHELL || "/bin/sh";
};

const ensureNodePtyHelperExecutable = () => {
  if (process.platform !== "darwin") return;
  try {
    const packageRoot = dirname(require.resolve("node-pty/package.json"));
    const helperPath = join(packageRoot, "prebuilds", `darwin-${process.arch}`, "spawn-helper");
    if (existsSync(helperPath)) chmodSync(helperPath, 0o755);
  } catch {}
};

const createSpawnEnv = () => {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
};

const trimBuffer = (value: string) =>
  value.length > MAX_BUFFER_CHARS ? value.slice(-MAX_BUFFER_CHARS) : value;

const isTerminalControlMessage = (value: unknown): value is TerminalControlMessage =>
  Boolean(value && typeof value === "object" && "type" in value);

export const startTerminalBridge = async (): Promise<StartTerminalBridgeResult> => {
  const sessions = new Map<string, TerminalSession>();
  const server = createServer((request, response) => {
    response.statusCode = 404;
    response.end();
  });
  const wss = new WebSocketServer({ server });

  const destroySession = (sessionId: string) => {
    const session = sessions.get(sessionId);
    if (!session) return;
    if (session.idleTimer) clearTimeout(session.idleTimer);
    session.idleTimer = null;
    try {
      session.pty.kill();
    } catch {}
    sessions.delete(sessionId);
  };

  const scheduleCleanup = (session: TerminalSession, timeoutMs = SESSION_IDLE_TIMEOUT_MS) => {
    if (session.idleTimer) clearTimeout(session.idleTimer);
    if (session.clients.size > 0) return;
    session.idleTimer = setTimeout(() => destroySession(session.id), timeoutMs);
    session.idleTimer.unref?.();
  };

  const broadcast = (session: TerminalSession, payload: string) => {
    for (const client of session.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      client.send(payload);
    }
  };

  const sendSnapshot = (socket: WebSocket, output: string) => {
    if (!output) return;
    const chunkSize = 8_192;
    for (let index = 0; index < output.length; index += chunkSize) {
      const chunk = output.slice(index, index + chunkSize);
      if (socket.readyState !== WebSocket.OPEN) return;
      socket.send(chunk);
    }
  };

  const ensureSession = (sessionId: string, cwd: string): TerminalSession => {
    const existing = sessions.get(sessionId);
    if (existing && !existing.closed) {
      if (existing.cwd !== cwd) {
        // Keep the first workspace for the session. The right panel is task-bound,
        // so a stable session is more useful than silently switching directories.
      }
      return existing;
    }

    if (existing?.closed) destroySession(sessionId);

    ensureNodePtyHelperExecutable();
    const shell = resolveShell();
    const pty = spawn(shell, [], {
      cols: 80,
      cwd: cwd || process.cwd(),
      env: createSpawnEnv(),
      name: "xterm-256color",
      rows: 24,
    });

    const session: TerminalSession = {
      clients: new Set(),
      closed: false,
      cwd: cwd || process.cwd(),
      exitCode: null,
      id: sessionId,
      output: "",
      pty,
      shell,
      idleTimer: null,
    };

    pty.onData((chunk) => {
      session.output = trimBuffer(`${session.output}${chunk}`);
      broadcast(session, chunk);
    });

    pty.onExit((event) => {
      session.closed = true;
      session.exitCode = event.exitCode;
      broadcast(session, JSON.stringify({ type: "exit", code: event.exitCode }));
      scheduleCleanup(session, 5_000);
    });

    sessions.set(sessionId, session);
    return session;
  };

  wss.on("connection", (socket, request) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const sessionId = (url.searchParams.get("sessionId") || randomUUID()).trim();
    const cwd = (url.searchParams.get("cwd") || process.cwd()).trim();
    const session = ensureSession(sessionId, cwd);

    if (session.output) {
      sendSnapshot(socket, session.output);
    }
    if (session.closed) {
      socket.send(JSON.stringify({ type: "exit", code: session.exitCode }));
    }

    session.clients.add(socket);
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = null;
    }

    socket.on("message", (raw) => {
      const text = typeof raw === "string" ? raw : raw.toString();
      try {
        const parsed = JSON.parse(text) as unknown;
        if (isTerminalControlMessage(parsed)) {
          if (parsed.type === "resize") {
            session.pty.resize(Math.max(1, Math.floor(parsed.cols)), Math.max(1, Math.floor(parsed.rows)));
            return;
          }
          if (parsed.type === "close") {
            socket.close();
            return;
          }
        }
      } catch {
        // Not JSON, treat as terminal input.
      }

      if (session.closed) return;
      session.pty.write(text);
    });

    socket.on("close", () => {
      session.clients.delete(socket);
      if (session.clients.size === 0) scheduleCleanup(session);
    });

    socket.on("error", () => {
      session.clients.delete(socket);
      if (session.clients.size === 0) scheduleCleanup(session);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start terminal bridge");
  }

  return {
    close: async () => {
      for (const sessionId of Array.from(sessions.keys())) {
        destroySession(sessionId);
      }
      await new Promise<void>((resolve) => {
        wss.close(() => {
          server.close(() => resolve());
        });
      });
    },
    getUrl: () => `ws://127.0.0.1:${address.port}`,
  };
};
