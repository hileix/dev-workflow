import { randomUUID } from "crypto";
import { createServer } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { interruptInteractiveSession, resizeInteractiveSession, writeInteractiveSessionInput } from "../../../packages/core-lib/langgraph-runtime/sdk-agent-adapter";

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
  pendingInput: string[];
  output: string;
  interactiveSessionId: string;
  idleTimer: NodeJS.Timeout | null;
}

interface StartTerminalBridgeResult {
  appendToSession: (sessionId: string, cwd: string, chunk: string) => void;
  close: () => Promise<void>;
  closeSession: (sessionId: string, exitCode?: number | null) => void;
  clearSession: (sessionId: string, cwd?: string) => void;
  setInteractiveSession: (sessionId: string, interactiveSessionId: string) => void;
  getUrl: () => string;
}

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
    if (existing) {
      if (cwd && !existing.cwd) existing.cwd = cwd;
      return existing;
    }

    const session: TerminalSession = {
      clients: new Set(),
      closed: false,
      cwd: cwd || process.cwd(),
      exitCode: null,
      id: sessionId,
      pendingInput: [],
      output: "",
      interactiveSessionId: "",
      idleTimer: null,
    };

    sessions.set(sessionId, session);
    return session;
  };

  const appendToSession = (sessionId: string, cwd: string, chunk: string) => {
    if (!chunk) return;
    const session = ensureSession(sessionId, cwd);
    if (session.closed) return;
    session.output = trimBuffer(`${session.output}${chunk}`);
    broadcast(session, chunk);
  };

  const clearSession = (sessionId: string, cwd = "") => {
    const session = ensureSession(sessionId, cwd);
    session.closed = false;
    session.exitCode = null;
    session.interactiveSessionId = "";
    session.pendingInput = [];
    session.output = "";
    broadcast(session, JSON.stringify({ type: "reset" }));
  };

  const setInteractiveSession = (sessionId: string, interactiveSessionId: string) => {
    const session = sessions.get(sessionId);
    if (!session) return;
    session.interactiveSessionId = String(interactiveSessionId || "");
    if (!session.interactiveSessionId || session.pendingInput.length === 0) return;
    const pendingInput = session.pendingInput.splice(0, session.pendingInput.length);
    for (const text of pendingInput) {
      writeInteractiveSessionInput(session.interactiveSessionId, text);
    }
  };

  const closeSession = (sessionId: string, exitCode: number | null = 0) => {
    const session = sessions.get(sessionId);
    if (!session) return;
    session.closed = true;
    session.exitCode = exitCode;
    session.interactiveSessionId = "";
    session.pendingInput = [];
    broadcast(session, JSON.stringify({ type: "exit", code: exitCode }));
    scheduleCleanup(session, 5_000);
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
          if (parsed.type === "close") {
            socket.close();
            return;
          }
          if (parsed.type === "resize") {
            const session = sessions.get(sessionId);
            const interactiveSessionId = session?.interactiveSessionId || "";
            if (interactiveSessionId) {
              resizeInteractiveSession(interactiveSessionId, parsed.cols, parsed.rows);
            }
            return;
          }
        }
      } catch {
        const session = sessions.get(sessionId);
        const interactiveSessionId = session?.interactiveSessionId || "";
        if (!interactiveSessionId) {
          if (session) session.pendingInput.push(text);
          return;
        }
        if (text === "\u0003") {
          interruptInteractiveSession(interactiveSessionId);
          return;
        }
        writeInteractiveSessionInput(interactiveSessionId, text);
      }
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
    appendToSession,
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
    closeSession,
    clearSession,
    setInteractiveSession,
    getUrl: () => `ws://127.0.0.1:${address.port}`,
  };
};
