import "@xterm/xterm/css/xterm.css";

import { AlertTriangle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { getAppApi } from "../lib/api-client";
import { useI18n } from "./i18n-provider";

const desktopApi = getAppApi();

function createTerminalTheme() {
  const styles = getComputedStyle(document.documentElement);
  const background = styles.getPropertyValue("--bg").trim() || "#0e0e0e";
  const foreground = styles.getPropertyValue("--fg").trim() || "#f4f4f5";
  const accent = styles.getPropertyValue("--primary").trim() || "#3b82f6";
  const muted = styles.getPropertyValue("--muted-fg").trim() || "#a1a1aa";
  return {
    background,
    black: "#111827",
    blue: accent,
    brightBlack: muted,
    brightBlue: accent,
    brightCyan: "#38bdf8",
    brightGreen: "#4ade80",
    brightMagenta: "#c084fc",
    brightRed: "#f87171",
    brightWhite: foreground,
    brightYellow: "#facc15",
    cursor: foreground,
    cyan: "#0891b2",
    foreground,
    green: "#16a34a",
    magenta: "#9333ea",
    red: "#dc2626",
    selectionBackground: `${accent}44`,
    white: foreground,
    yellow: "#ca8a04",
  };
}

function isControlPayload(value) {
  try {
    const parsed = JSON.parse(value);
    if (parsed?.type === "exit") return parsed;
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

function fileToImagePayload(file) {
  return file.arrayBuffer().then((buffer) => ({
    name: file.name || `image-${Date.now()}.png`,
    data: Array.from(new Uint8Array(buffer)),
    type: file.type || "application/octet-stream",
  }));
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
  backendLabel,
  cwd,
  enableShell = false,
  interactions = [],
  isRunning = false,
  isStreaming = false,
  isPaused = false,
  phaseKey,
  phaseLabel,
  modelLabel = "",
  onInterrupt,
  onSendMessage,
  sessionId,
  taskInputs = {},
  taskTitle,
}) {
  const { t } = useI18n();
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const terminalRef = useRef(null);
  const activityStateRef = useRef({
    count: 0,
    key: "",
    lastType: "",
    runningSignature: "",
    taskIntroSignature: "",
  });
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [error, setError] = useState("");
  const [, setStatus] = useState("connecting");
  const [terminalReadyTick, setTerminalReadyTick] = useState(0);
  const isSubmittingRef = useRef(false);
  const attachmentsRef = useRef([]);
  const activityKey = `${sessionId || ""}:${phaseKey || phaseLabel || ""}`;
  const showComposer = Boolean(onSendMessage) && Boolean(phaseKey) && (isRunning || isStreaming || isPaused);

  useEffect(() => {
    if (!containerRef.current) return;
    if (enableShell && (!cwd || !sessionId)) {
      setStatus("error");
      setError(t("stepDetail.terminalNoWorkspace"));
      return;
    }

    let disposed = false;
    let resizeObserver = null;
    let resizeTimer = null;
    let socket = null;
    let terminal = null;
    let inputSubscription = null;
    let fitAddon = null;

    const clearResizeTimer = () => {
      if (resizeTimer) window.clearTimeout(resizeTimer);
      resizeTimer = null;
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

    setStatus("connecting");
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
        nextTerminal.focus();

        terminal = nextTerminal;
        terminalRef.current = nextTerminal;
        fitAddon = nextFitAddon;
        setTerminalReadyTick((value) => value + 1);

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

        if (!enableShell) {
          setStatus("connected");
          return;
        }

        const bridgeUrl = await desktopApi.getTerminalBridgeUrl?.();
        if (disposed || terminal !== nextTerminal) return;
        if (!bridgeUrl) {
          setStatus("error");
          setError(t("stepDetail.terminalUnavailable"));
          nextTerminal.writeln(t("stepDetail.terminalUnavailable"));
          return;
        }

        const url = new URL(bridgeUrl);
        url.searchParams.set("sessionId", sessionId);
        url.searchParams.set("cwd", cwd);
        socket = new WebSocket(url.toString());

        socket.addEventListener("open", () => {
          if (disposed) return;
          setStatus("connected");
          sendResize();
          nextTerminal.focus();
        });

        socket.addEventListener("message", (event) => {
          if (disposed) return;
          const chunk = typeof event.data === "string" ? event.data : "";
          const control = isControlPayload(chunk);
          if (control?.type === "exit") {
            setStatus("closed");
            return;
          }
          nextTerminal.write(chunk);
        });

        socket.addEventListener("close", () => {
          if (disposed) return;
          setStatus((current) => (current === "error" ? current : "closed"));
        });

        socket.addEventListener("error", () => {
          if (disposed) return;
          setStatus("error");
          setError(t("stepDetail.terminalError"));
        });

        inputSubscription = nextTerminal.onData((chunk) => {
          if (!socket || socket.readyState !== WebSocket.OPEN) return;
          socket.send(chunk);
        });
      })
      .catch((err) => {
        if (disposed) return;
        setStatus("error");
        setError(err?.message || t("stepDetail.terminalError"));
      });

    return () => {
      disposed = true;
      clearResizeTimer();
      window.removeEventListener("resize", scheduleResize);
      resizeObserver?.disconnect();
      inputSubscription?.dispose();
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "close" }));
      }
      socket?.close();
      terminal?.dispose();
      if (terminalRef.current === terminal) terminalRef.current = null;
    };
  }, [cwd, enableShell, sessionId, t]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    const state = activityStateRef.current;
    if (state.key !== activityKey) {
      state.key = activityKey;
      state.count = 0;
      state.lastType = "";
      state.taskIntroSignature = "";
      state.runningSignature = "";
      terminal.reset();
    }

    const taskIntroSignature = JSON.stringify({
      cwd,
      phaseLabel,
      taskInputs,
      taskTitle,
    });
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
  }, [activityKey, backendLabel, cwd, interactions, isRunning, isStreaming, phaseLabel, taskInputs, taskTitle, terminalReadyTick]);

  useEffect(() => {
    setDraft("");
    setAttachments((prev) => {
      for (const attachment of prev) {
        URL.revokeObjectURL(attachment.preview);
      }
      return [];
    });
    isSubmittingRef.current = false;
    inputRef.current?.focus?.();
  }, [activityKey]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => () => {
    for (const attachment of attachmentsRef.current) {
      URL.revokeObjectURL(attachment.preview);
    }
  }, []);

  function addImageFiles(files) {
    const imageFiles = [];
    for (const file of files) {
      if (!file?.type?.startsWith("image/")) continue;
      imageFiles.push({ file, preview: URL.createObjectURL(file) });
    }
    if (imageFiles.length > 0) {
      setAttachments((prev) => [...prev, ...imageFiles]);
    }
  }

  function handlePaste(event) {
    const items = event.clipboardData?.items;
    if (!items) return;
    const files = [];
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      event.preventDefault();
      addImageFiles(files);
    }
  }

  function handleDrop(event) {
    event.preventDefault();
    const files = Array.from(event.dataTransfer?.files || []);
    const imageFiles = files.filter((file) => file?.type?.startsWith("image/"));
    if (imageFiles.length > 0) {
      addImageFiles(imageFiles);
    }
  }

  function removeAttachment(index) {
    setAttachments((prev) => {
      const next = [...prev];
      const [removed] = next.splice(index, 1);
      if (removed?.preview) URL.revokeObjectURL(removed.preview);
      return next;
    });
  }

  async function handleInterrupt() {
    if (isSubmittingRef.current || !onInterrupt || !phaseKey || (!isRunning && !isStreaming)) return;
    isSubmittingRef.current = true;
    setError("");
    try {
      const result = await onInterrupt(phaseKey);
      if (result === false) throw new Error(t("stepDetail.terminalError"));
      inputRef.current?.focus?.();
    } catch (err) {
      setError(err?.message || t("stepDetail.terminalError"));
    } finally {
      isSubmittingRef.current = false;
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const text = draft.trim();
    if (isSubmittingRef.current || (!text && attachments.length === 0) || !onSendMessage || !phaseKey) return;
    const nextAttachments = attachments;
    isSubmittingRef.current = true;
    setDraft("");
    setAttachments((prev) => {
      for (const attachment of prev) {
        URL.revokeObjectURL(attachment.preview);
      }
      return [];
    });
    setError("");
    try {
      const imagePayloads = await Promise.all(nextAttachments.map((attachment) => fileToImagePayload(attachment.file)));
      const result = await onSendMessage(text, imagePayloads);
      if (result === false) throw new Error(t("stepDetail.terminalError"));
      inputRef.current?.focus?.();
    } catch (err) {
      setError(err?.message || t("stepDetail.terminalError"));
    } finally {
      isSubmittingRef.current = false;
    }
  }

  return (
    <aside className="flex min-h-0 flex-col overflow-hidden border-t border-border bg-card/45 xl:border-l xl:border-t-0">
      <div className="relative min-h-0 flex-1 bg-background px-3 pb-6 pt-3">
        <div ref={containerRef} className="h-full min-h-0 w-full overflow-hidden" />
        {error ? (
          <div className="pointer-events-none absolute inset-x-3 top-3 rounded-md border border-destructive/40 bg-background/95 px-3 py-2 text-xs text-destructive shadow-sm">
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {error}
            </span>
          </div>
        ) : null}
      </div>
      {showComposer ? (
        <form className="border-t border-border bg-background px-3 pt-2 pb-0" onSubmit={handleSubmit}>
          {attachments.length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-2">
              {attachments.map((attachment, index) => (
                <button
                  key={attachment.preview}
                  type="button"
                  onClick={() => removeAttachment(index)}
                  className="group relative h-14 w-14 overflow-hidden rounded-md border border-border bg-card"
                  title={attachment.file.name}
                >
                  <img src={attachment.preview} alt={attachment.file.name} className="h-full w-full object-cover" />
                  <span className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-background/90 text-[10px] text-muted-foreground opacity-90 group-hover:text-foreground">
                    <X className="h-2.5 w-2.5" />
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="border-y border-border bg-card/70 py-2 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="select-none font-mono text-[13px] text-primary">$</span>
              <input
                ref={inputRef}
                type="text"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.ctrlKey && event.key.toLowerCase() === "c") {
                    event.preventDefault();
                    void handleInterrupt();
                    return;
                  }
                  if (event.key === "Escape" && (isRunning || isStreaming)) {
                    event.preventDefault();
                    void handleInterrupt();
                  }
                }}
                onPaste={handlePaste}
                onDrop={handleDrop}
                aria-label={t("stepDetail.terminal")}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className="h-6 min-w-0 flex-1 border-0 bg-transparent p-0 font-mono text-[13px] leading-6 text-foreground outline-none placeholder:text-muted-foreground focus:ring-0"
              />
            </div>
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-2 font-mono text-[12px] leading-5">
            <span className="min-w-0 truncate text-emerald-600" title={modelLabel || t("stepDetail.terminal")}>
              {modelLabel || "default model"}
            </span>
            <span className="shrink-0 text-muted-foreground">•</span>
          </div>
        </form>
      ) : null}
    </aside>
  );
}
