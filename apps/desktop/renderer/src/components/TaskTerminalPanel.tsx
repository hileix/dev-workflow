import "@xterm/xterm/css/xterm.css";

import { AlertTriangle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { getAppApi } from "../lib/api-client";
import { useI18n } from "./i18n-provider";

const desktopApi = getAppApi();

function createTerminalTheme() {
  return {
    background: "#0b1020",
    black: "#0f172a",
    blue: "#60a5fa",
    brightBlack: "#64748b",
    brightBlue: "#93c5fd",
    brightCyan: "#67e8f9",
    brightGreen: "#86efac",
    brightMagenta: "#d8b4fe",
    brightRed: "#fda4af",
    brightWhite: "#f8fafc",
    brightYellow: "#fde68a",
    cursor: "#e2e8f0",
    cyan: "#22d3ee",
    foreground: "#e2e8f0",
    green: "#4ade80",
    magenta: "#c084fc",
    red: "#f87171",
    selectionBackground: "#2563eb55",
    white: "#cbd5e1",
    yellow: "#fbbf24",
  };
}

function isControlPayload(value) {
  try {
    const parsed = JSON.parse(value);
    if (parsed?.type === "exit" || parsed?.type === "reset") return parsed;
  } catch {}
  return null;
}

function stripAnsi(value) {
  return String(value || "").replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

function safeTerminalText(value) {
  return stripAnsi(value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[^\x09\x0A\x20-\x7E\u0080-\uFFFF]/g, "")
    .replace(/\n/g, "\r\n");
}

function compactInline(value) {
  return safeTerminalText(value).replace(/\s+/g, " ").trim();
}

function writeLine(terminal, value = "") {
  terminal.write(`${value}\r\n`);
}

function hasTaskInput(taskInputs, taskTitle) {
  if (String(taskTitle || "").trim()) return true;
  return Object.values(taskInputs || {}).some((value) => String(value || "").trim());
}

function writeTaskIntro(terminal, { cwd, phaseLabel, taskInputs, taskTitle }) {
  if (!hasTaskInput(taskInputs, taskTitle)) return;
  writeLine(terminal);
  writeLine(terminal, "\x1b[36m$ dev-workflow start\x1b[0m");
  if (String(taskTitle || "").trim()) {
    writeLine(terminal, `task: ${safeTerminalText(taskTitle)}`);
  }
  if (phaseLabel) writeLine(terminal, `phase: ${safeTerminalText(phaseLabel)}`);
  if (cwd) writeLine(terminal, `cwd: ${safeTerminalText(cwd)}`);

  const entries = Object.entries(taskInputs || {}).filter(([, value]) => String(value || "").trim());
  if (entries.length > 0) {
    writeLine(terminal);
    writeLine(terminal, "\x1b[34m> user input\x1b[0m");
    for (const [key, value] of entries) {
      writeLine(terminal, `${safeTerminalText(key)}:`);
      writeLine(terminal, safeTerminalText(value));
    }
  }
  writeLine(terminal);
}

function writeInteraction(terminal, interaction, state, phaseLabel) {
  if (!interaction) return;

  if (interaction.type === "phase_start") {
    const backend = interaction.backend ? ` ${interaction.backend}` : "";
    const run = interaction.runIndex ? ` run ${interaction.runIndex}` : "";
    writeLine(terminal);
    writeLine(terminal, `\x1b[36m$ workflow phase ${safeTerminalText(phaseLabel || interaction.phase || "")}${backend}${run}\x1b[0m`);
    state.lastType = "phase_start";
    return;
  }

  if (interaction.role === "user" || interaction.type === "user_message") {
    writeLine(terminal);
    writeLine(terminal, "\x1b[34m> user\x1b[0m");
    writeLine(terminal, safeTerminalText(interaction.text || ""));
    state.lastType = "user";
    return;
  }

  if (interaction.type === "prompt") {
    if (!String(interaction.text || "").trim()) return;
    writeLine(terminal);
    writeLine(terminal, "\x1b[35m> prompt\x1b[0m");
    writeLine(terminal, safeTerminalText(interaction.text));
    state.lastType = "prompt";
    return;
  }

  if (interaction.type === "tool_use" || interaction.role === "tool") {
    const command = compactInline(interaction.text || interaction.log || interaction.backend || "tool");
    if (!command) return;
    writeLine(terminal);
    writeLine(terminal, `\x1b[33m$ ${command.replace(/^`?\$?\s*/, "").replace(/`$/, "")}\x1b[0m`);
    state.lastType = "tool";
    return;
  }

  if (interaction.type === "assistant_delta" || interaction.role === "assistant") {
    const text = safeTerminalText(interaction.text || "");
    if (!text) return;
    if (state.lastType !== "assistant_delta") {
      writeLine(terminal);
    }
    terminal.write(text);
    state.lastType = "assistant_delta";
    return;
  }

  if (interaction.text) {
    writeLine(terminal);
    writeLine(terminal, `\x1b[90m# ${safeTerminalText(interaction.type || "event")}\x1b[0m`);
    writeLine(terminal, safeTerminalText(interaction.text));
    state.lastType = interaction.type || "event";
  }
}

function hasAgentOutput(interactions) {
  return interactions.some((interaction) =>
    interaction?.type === "assistant_delta" ||
    interaction?.type === "tool_use" ||
    interaction?.role === "assistant" ||
    interaction?.role === "tool"
  );
}

function writeRunningMarker(terminal, { backendLabel, interactions, isRunning, isStreaming, phaseLabel }, state) {
  const running = isRunning || isStreaming;
  const signature = `${backendLabel || ""}:${phaseLabel || ""}:${running}:${hasAgentOutput(interactions)}`;
  if (!running || hasAgentOutput(interactions)) {
    state.runningSignature = signature;
    return;
  }
  if (state.runningSignature === signature) return;
  writeLine(terminal);
  writeLine(terminal, `\x1b[36m$ ${(backendLabel || "agent").toLowerCase()} running\x1b[0m`);
  writeLine(terminal, "waiting for streamed agent output...");
  state.runningSignature = signature;
}

export default function TaskTerminalPanel({
  agentSessionId,
  backendLabel,
  backendType,
  className = "",
  cwd,
  enableShell = false,
  interactions = [],
  isRunning = false,
  isStreaming = false,
  isPaused = false,
  isAwaiting = false,
  isFailed = false,
  isCompleted = false,
  phaseKey,
  phaseLabel,
  runId,
  sessionId,
  taskInputs = {},
  taskTitle,
}) {
  const { t } = useI18n();
  const containerRef = useRef(null);
  const terminalRef = useRef(null);
  const activityStateRef = useRef({
    count: 0,
    key: "",
    lastType: "",
    runningSignature: "",
    taskIntroSignature: "",
  });
  const [error, setError] = useState("");
  const [terminalReadyTick, setTerminalReadyTick] = useState(0);
  const activityKey = `${sessionId || ""}:${phaseKey || phaseLabel || ""}`;
  const restoredSessionKeyRef = useRef("");

  useEffect(() => {
    if (!containerRef.current) return;
    if (enableShell && (!cwd || !sessionId)) {
      setError(t("stepDetail.terminalNoWorkspace"));
      return;
    }

    let disposed = false;
    let resizeObserver = null;
    let resizeTimer = null;
    let socket = null;
    let terminal = null;
    let fitAddon = null;
    let inputDisposable = null;
    let socketReady = false;
    let pendingInput = [];

    const clearResizeTimer = () => {
      if (resizeTimer) window.clearTimeout(resizeTimer);
      resizeTimer = null;
    };

    const flushPendingInput = () => {
      if (!socket || socket.readyState !== WebSocket.OPEN || !socketReady || pendingInput.length === 0) return;
      for (const chunk of pendingInput) {
        socket.send(chunk);
      }
      pendingInput = [];
    };

    const sendInput = (text) => {
      if (!text) return;
      if (socket && socket.readyState === WebSocket.OPEN && socketReady) {
        socket.send(text);
        return;
      }
      pendingInput.push(text);
    };

    const sendResize = () => {
      if (!socket || socket.readyState !== WebSocket.OPEN || !terminal) return;
      socket.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
    };

    const scheduleResize = () => {
      clearResizeTimer();
      resizeTimer = window.setTimeout(() => {
        resizeTimer = null;
        if (!fitAddon || !terminal) return;
        fitAddon.fit();
        sendResize();
      }, 50);
    };

    setError("");

    void Promise.all([
      import("@xterm/xterm"),
      import("@xterm/addon-fit"),
      import("@xterm/addon-unicode11"),
      import("@xterm/addon-clipboard"),
    ])
      .then(async ([xtermModule, fitModule, unicode11Module, clipboardModule]) => {
        if (disposed || !containerRef.current) return;

        const nextTerminal = new xtermModule.Terminal({
          allowProposedApi: true,
          cursorBlink: true,
          cursorStyle: "bar",
          fontFamily: "'SF Mono', 'DM Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 13,
          letterSpacing: 0,
          lineHeight: 1.25,
          scrollback: 10_000,
          theme: createTerminalTheme(),
        });
        const nextFitAddon = new fitModule.FitAddon();
        nextTerminal.loadAddon(nextFitAddon);
        nextTerminal.loadAddon(new unicode11Module.Unicode11Addon());
        nextTerminal.unicode.activeVersion = "11";
        nextTerminal.loadAddon(new clipboardModule.ClipboardAddon());
        nextTerminal.open(containerRef.current);
        nextFitAddon.fit();

        terminal = nextTerminal;
        terminalRef.current = nextTerminal;
        fitAddon = nextFitAddon;
        setTerminalReadyTick((value) => value + 1);
        inputDisposable = nextTerminal.onData(sendInput);

        void import("@xterm/addon-web-links")
          .then((webLinksModule) => {
            if (!disposed && terminal === nextTerminal) {
              nextTerminal.loadAddon(new webLinksModule.WebLinksAddon());
            }
          })
          .catch(() => {});

        void import("@xterm/addon-webgl")
          .then((webglModule) => {
            if (disposed || terminal !== nextTerminal) return;
            try {
              const webglAddon = new webglModule.WebglAddon();
              webglAddon.onContextLoss(() => webglAddon.dispose());
              nextTerminal.loadAddon(webglAddon);
            } catch {}
          })
          .catch(() => {});

        if (typeof ResizeObserver !== "undefined" && containerRef.current) {
          resizeObserver = new ResizeObserver(scheduleResize);
          resizeObserver.observe(containerRef.current);
        }
        window.addEventListener("resize", scheduleResize);

        if (enableShell) {
          const canRestoreFromHistory = backendType === "codex" && !isRunning && !isStreaming && !isPaused && !isAwaiting;
          const restoreKey = `${backendType || ""}:${agentSessionId || ""}:${sessionId || ""}:${canRestoreFromHistory ? "history" : ""}`;
          const bridgeUrl = await desktopApi.getTerminalBridgeUrl?.();
          if (disposed || terminal !== nextTerminal) return;
          if (!bridgeUrl) throw new Error(t("stepDetail.terminalUnavailable"));

          const url = new URL(bridgeUrl);
          url.searchParams.set("sessionId", sessionId);
          url.searchParams.set("cwd", cwd || "");
          const rerunInputPayload = {
            taskId: taskTitle,
            runId: runId || "",
            phase: phaseKey || phaseLabel || "",
          };
          if (isCompleted) {
            await desktopApi.attachRerunTerminalInput?.(rerunInputPayload);
            if (disposed || terminal !== nextTerminal) return;
          }
          let resolveSocketOpen = null;
          const socketOpenPromise = new Promise((resolve) => {
            resolveSocketOpen = resolve;
          });
          socket = new WebSocket(url.toString());
          socket.addEventListener("open", () => {
            if (disposed || terminal !== nextTerminal) return;
            socketReady = true;
            sendResize();
            if (!isCompleted) flushPendingInput();
            if (!isCompleted) nextTerminal.focus();
            resolveSocketOpen?.();
          });
          socket.addEventListener("message", (event) => {
            const value = typeof event.data === "string" ? event.data : "";
            const control = isControlPayload(value);
            if (control?.type === "reset") {
              nextTerminal.reset();
              return;
            }
            if (control?.type === "exit") return;
            if (value) nextTerminal.write(value);
          });
          socket.addEventListener("close", () => {
            socketReady = false;
            pendingInput = [];
          });
          socket.addEventListener("error", () => {
            if (!disposed) setError(t("stepDetail.terminalError"));
          });
          if (
            backendType &&
            !isRunning &&
            !isStreaming &&
            !isPaused &&
            !isAwaiting &&
            (agentSessionId || canRestoreFromHistory) &&
            restoredSessionKeyRef.current !== restoreKey
          ) {
            await socketOpenPromise;
            if (disposed || terminal !== nextTerminal) return;
            restoredSessionKeyRef.current = restoreKey;
            await desktopApi.restoreTerminalSession?.({
              taskId: taskTitle,
              runId: runId || "",
              phase: phaseKey || phaseLabel || "",
              backend: backendType,
              agentSessionId,
              workFolder: cwd || "",
            });
          }
          if (isCompleted) {
            await desktopApi.attachRerunTerminalInput?.(rerunInputPayload);
            if (disposed || terminal !== nextTerminal) return;
            nextTerminal.focus();
            flushPendingInput();
          }
        }
      })
      .catch((err) => {
        if (disposed) return;
        setError(err?.message || t("stepDetail.terminalError"));
      });

    return () => {
      disposed = true;
      clearResizeTimer();
      window.removeEventListener("resize", scheduleResize);
      resizeObserver?.disconnect();
      inputDisposable?.dispose();
      socket?.close();
      terminal?.dispose();
      if (terminalRef.current === terminal) terminalRef.current = null;
    };
  }, [agentSessionId, backendType, cwd, enableShell, isAwaiting, isCompleted, isPaused, isRunning, isStreaming, phaseKey, phaseLabel, runId, sessionId, t, taskTitle]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    const state = activityStateRef.current;
    const activityChanged = state.key !== activityKey;
    if (activityChanged) {
      restoredSessionKeyRef.current = "";
      state.key = activityKey;
      state.count = 0;
      state.lastType = "";
      state.taskIntroSignature = "";
      state.runningSignature = "";
      terminal.reset();
    }

    if (enableShell) return;

    const taskIntroSignature = JSON.stringify({ cwd, phaseLabel, taskInputs, taskTitle });
    if (state.taskIntroSignature !== taskIntroSignature) {
      state.taskIntroSignature = taskIntroSignature;
      writeTaskIntro(terminal, { cwd, phaseLabel, taskInputs, taskTitle });
    }

    const nextInteractions = interactions.slice(state.count);
    for (const interaction of nextInteractions) {
      writeInteraction(terminal, interaction, state, phaseLabel);
    }
    state.count = interactions.length;
    writeRunningMarker(terminal, { backendLabel, interactions, isRunning, isStreaming, phaseLabel }, state);
  }, [activityKey, backendLabel, cwd, enableShell, interactions, isRunning, isStreaming, phaseLabel, taskInputs, taskTitle, terminalReadyTick]);
  return (
    <aside
      className={`flex min-h-0 flex-col overflow-hidden border-t border-slate-800/80 bg-slate-950 xl:border-l xl:border-t-0 ${className}`.trim()}
      onMouseDownCapture={(event) => {
        event.preventDefault();
        window.requestAnimationFrame(() => terminalRef.current?.focus?.());
      }}
    >
      <div className="relative min-h-0 flex-1 bg-slate-950 p-3">
        <div ref={containerRef} className="workflow-terminal-output h-full min-h-0 w-full overflow-hidden" />
        {error ? (
          <div className="pointer-events-none absolute inset-x-3 top-3 rounded-md border border-rose-500/35 bg-slate-900/95 px-3 py-2 text-xs text-rose-300 shadow-sm">
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {error}
            </span>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
