import { useState, useRef, useEffect, useCallback } from "react";
import Markdown from "react-markdown";
import { Bot, FileText, Send, Terminal, User, X } from "lucide-react";
import { Badge } from "./components/ui/badge";
import { useI18n } from "./components/i18n-provider";
import { Button } from "./components/ui/button";
import { useWorkflowStore } from "./stores/workflowStore";
import { getAppApi } from "./lib/api-client";

const desktopApi = getAppApi();

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function normalizeConversation(interactions) {
  const items = [];
  let activeAssistant = null;

  function ensureAssistant(interaction) {
    if (!activeAssistant) {
      activeAssistant = {
        ...interaction,
        id: interaction.id || `assistant-${items.length}`,
        role: "assistant",
        type: "assistant_message",
        text: "",
        segments: [],
      };
      items.push(activeAssistant);
    }
    activeAssistant.at = interaction.at || activeAssistant.at;
    activeAssistant.backend = interaction.backend || activeAssistant.backend;
    return activeAssistant;
  }

  for (const interaction of interactions || []) {
    if (!interaction) continue;
    if (interaction.type === "prompt") continue;

    if (interaction.type === "assistant_delta") {
      const assistant = ensureAssistant(interaction);
      const lastSegment = assistant.segments[assistant.segments.length - 1];
      assistant.text = `${assistant.text || ""}${interaction.text || ""}`;
      if (lastSegment?.type === "text") {
        lastSegment.text = `${lastSegment.text || ""}${interaction.text || ""}`;
      } else {
        assistant.segments.push({ type: "text", text: interaction.text || "" });
      }
      continue;
    }

    if (interaction.type === "tool_use") {
      const assistant = ensureAssistant(interaction);
      const lastSegment = assistant.segments[assistant.segments.length - 1];
      const tool = {
        text: interaction.text || interaction.log || "",
        backend: interaction.backend,
      };
      if (lastSegment?.type === "tools") {
        lastSegment.tools.push(tool);
      } else {
        assistant.segments.push({ type: "tools", tools: [tool] });
      }
      continue;
    }

    if (interaction.type === "prompt" && !interaction.text) continue;
    activeAssistant = null;
    items.push(interaction);
  }
  return items;
}

function getBackendLabel(backend) {
  if (backend === "codex") return "Codex";
  if (backend === "claude") return "Claude Code";
  return "AI Conversation";
}

function getCurrentBackend(activeBackend, interactions) {
  if (activeBackend) return activeBackend;
  for (let i = (interactions || []).length - 1; i >= 0; i -= 1) {
    if (interactions[i]?.backend) return interactions[i].backend;
  }
  return "";
}

function isWaitingForAssistant(conversation, isRunning, isStreaming) {
  if (!isRunning && !isStreaming) return false;
  return true;
}

function getInteractionMeta(item, t) {
  if (item.role === "user") {
    return { label: t("stepDetail.user"), icon: User, tone: "user" };
  }
  if (item.role === "tool") {
    return { label: t("stepDetail.tool"), icon: Terminal, tone: "tool" };
  }
  if (item.type === "prompt") {
    return { label: t("stepDetail.prompt"), icon: Terminal, tone: "system" };
  }
  return { label: t("stepDetail.assistant"), icon: Bot, tone: "assistant" };
}

function ConversationItem({ item, t }) {
  const meta = getInteractionMeta(item, t);
  const Icon = meta.icon;
  const isUser = meta.tone === "user";
  const isSystem = meta.tone === "system" || meta.tone === "tool";
  const wrapperClass = isUser ? "flex justify-end" : "";
  const bubbleClass = isUser
    ? "max-w-[86%] border-primary/25 bg-primary/10"
    : isSystem
      ? "border-border bg-muted/45"
      : "border-border bg-card/72";
  const showHeader = isSystem;

  return (
    <div className={wrapperClass}>
      <div className={`rounded-lg border px-3 py-2.5 ${bubbleClass}`}>
        {showHeader && (
          <div className="mb-2 flex items-center justify-between gap-2 text-[11px] font-semibold text-muted-foreground">
            <span className="flex min-w-0 items-center gap-1.5">
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{meta.label}</span>
              {item.backend && <span className="font-mono font-normal text-muted-foreground/80">{item.backend}</span>}
            </span>
            {item.at && <span className="shrink-0 font-mono font-normal">{formatTime(item.at)}</span>}
          </div>
        )}
        {item.type === "prompt" ? (
          <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-background/70 px-2.5 py-2 font-mono text-[11px] leading-5 text-foreground">
            {item.text}
          </pre>
        ) : item.role === "tool" ? (
          <div className="break-words font-mono text-xs leading-5 text-muted-foreground">{item.text}</div>
        ) : item.role === "assistant" && item.segments?.length > 0 ? (
          <div className="space-y-3">
            {item.segments.map((segment, idx) => (
              segment.type === "tools" ? (
                <details key={idx} className="rounded-md border border-border bg-muted/45 px-2.5 py-2 font-mono text-[11px] leading-5 text-muted-foreground">
                  <summary className="cursor-pointer select-none text-[10px] font-semibold uppercase text-muted-foreground/80">
                    {t("stepDetail.toolsCount", { count: segment.tools.length })}
                  </summary>
                  <div className="mt-2 space-y-2">
                    {segment.tools.map((tool, toolIdx) => (
                      <div key={toolIdx} className="break-words border-t border-border/70 pt-2 first:border-t-0 first:pt-0">
                        {tool.text}
                      </div>
                    ))}
                  </div>
                </details>
              ) : (
                <div key={idx} className="prose prose-sm dark:prose-invert max-w-none break-words">
                  <Markdown>{segment.text || ""}</Markdown>
                </div>
              )
            ))}
          </div>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none break-words">
            <Markdown>{item.text || ""}</Markdown>
          </div>
        )}
        {item.imageCount > 0 && (
          <div className="mt-2 text-[11px] text-muted-foreground">
            {t("stepDetail.attachments", { count: item.imageCount })}
          </div>
        )}
        {!isSystem && item.at && (
          <div className={`mt-1.5 font-mono text-[9px] leading-none text-muted-foreground/70 ${isUser ? "text-right" : "text-left"}`}>
            {formatTime(item.at)}
          </div>
        )}
      </div>
    </div>
  );
}

function LoadingItem({ t }) {
  return (
    <div className="rounded-lg border border-border bg-card/72 px-3 py-2.5">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="flex gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/70 animate-pulse-subtle" />
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/70 animate-pulse-subtle [animation-delay:120ms]" />
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/70 animate-pulse-subtle [animation-delay:240ms]" />
        </span>
        {t("stepDetail.waitingForAi")}
      </div>
    </div>
  );
}

export default function StepDetail({ phase, content, artifact, interactions = [], emptyDocumentMessage = "", activeBackend, isStreaming, isRunning, isAwaiting, isFailed, onApprove, onReject, onSendMessage, onOpenDocument, phaseLabels, phaseTypes, rejectTargets }) {
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const [images, setImages] = useState([]);
  const [quotedText, setQuotedText] = useState("");
  const [quoteButton, setQuoteButton] = useState(null);
  const [rejectTarget, setRejectTarget] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const contentRef = useRef(null);
  const conversationRef = useRef(null);
  const composerRef = useRef(null);
  const wasStreamingRef = useRef(false);
  const fileInputRef = useRef(null);
  const imagesRef = useRef([]);
  const activeTicket = useWorkflowStore((s) => s.activeTicket);
  const workflowState = useWorkflowStore((s) => s.workflowState);

  const conversation = normalizeConversation(interactions);
  const isCheckpoint = phaseTypes?.[phase] === "checkpoint";
  const currentBackend = isCheckpoint ? t("stepDetail.checkpoint") : getBackendLabel(getCurrentBackend(activeBackend, interactions));
  const showLoading = !isCheckpoint && isWaitingForAssistant(conversation, isRunning, isStreaming);
  const canSend = !isCheckpoint && isAwaiting && !isStreaming && !isRunning;
  const showComposer = !isCheckpoint && (isAwaiting || isStreaming || isRunning);
  const rejectOptions = isCheckpoint ? rejectTargets?.[phase] || [] : [];
  const DetailIcon = isCheckpoint ? User : Bot;

  useEffect(() => {
    if (conversationRef.current) {
      conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
    }
  }, [phase, interactions.length, showLoading]);

  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming && !isRunning && contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming, isRunning]);

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(() => {
    return () => {
      for (const img of imagesRef.current) URL.revokeObjectURL(img.preview);
    };
  }, []);

  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!text || !sel?.rangeCount || !contentRef.current?.contains(sel.anchorNode)) {
      setQuoteButton(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const containerRect = contentRef.current.getBoundingClientRect();
    setQuoteButton({
      text,
      top: rect.top - containerRect.top + contentRef.current.scrollTop - 36,
      left: rect.left - containerRect.left + rect.width / 2,
    });
  }, []);

  useEffect(() => {
    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, [handleMouseUp]);

  function addImageFiles(files) {
    const newImages = [];
    for (const file of files || []) {
      if (!file.type.startsWith("image/")) continue;
      newImages.push({ file, preview: URL.createObjectURL(file) });
    }
    if (newImages.length > 0) setImages((prev) => [...prev, ...newImages]);
  }

  function handlePaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles = [];
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      addImageFiles(imageFiles);
    }
  }

  function removeImage(idx) {
    setImages((prev) => {
      URL.revokeObjectURL(prev[idx].preview);
      return prev.filter((_, i) => i !== idx);
    });
  }

  function openRejectModal(target) {
    setRejectTarget(target);
    setRejectReason("");
  }

  function closeRejectModal() {
    setRejectTarget("");
    setRejectReason("");
  }

  function submitReject(e) {
    e.preventDefault();
    const reason = rejectReason.trim();
    if (!rejectTarget || !reason) return;
    onReject?.(rejectTarget, reason);
    closeRejectModal();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSend) return;
    let text = input.trim();
    if (!text && images.length === 0) return;

    if (quotedText) {
      const quoted = quotedText.split("\n").map((l) => `> ${l}`).join("\n");
      text = `${quoted}\n\n${text}`;
    }

    try {
      let uploadedPaths = [];
      const runId = workflowState?.runId || "";
      if (images.length > 0 && activeTicket && runId) {
        const payload = await Promise.all(images.map(async (img) => ({
          name: img.file.name,
          data: Array.from(new Uint8Array(await img.file.arrayBuffer())),
        })));
        const data = await desktopApi.saveTaskUploads(runId, payload);
        uploadedPaths = data.paths || [];
      }

      setInput("");
      for (const img of images) URL.revokeObjectURL(img.preview);
      setImages([]);
      setQuotedText("");
      await onSendMessage(text, uploadedPaths.length > 0 ? uploadedPaths : undefined);
    } catch {}
  }

  if (!phase) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
          {t("stepDetail.selectStep")}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-border bg-background/78 px-6 py-4">
        <h2 className="text-base font-semibold text-foreground">{phaseLabels?.[phase] || phase}</h2>
        {isCheckpoint && <Badge variant="outline">{t("stepDetail.checkpoint")}</Badge>}
        {isStreaming && <Badge variant="info" className="animate-pulse-subtle">{t("stepDetail.streaming")}</Badge>}
        {!isStreaming && isRunning && <Badge variant="info" className="animate-pulse-subtle">{t("stepDetail.running")}</Badge>}
        {isAwaiting && <Badge variant="warning">{t("stepDetail.waitingForInput")}</Badge>}
        {isFailed && <Badge variant="destructive">{t("status.failed")}</Badge>}
      </div>

      <div className="grid min-h-0 flex-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="flex min-h-0 flex-col overflow-hidden">
          <div className="relative min-h-0 flex-1 overflow-y-auto px-6 pb-8 pt-6 text-sm leading-relaxed" ref={contentRef}>
            {quoteButton && (
              <button
                className="absolute z-20 bg-foreground text-background text-xs px-2.5 py-1 rounded shadow-lg hover:opacity-80"
                style={{ top: quoteButton.top, left: quoteButton.left, transform: "translateX(-50%)" }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setQuotedText(quoteButton.text);
                  setQuoteButton(null);
                  window.getSelection()?.removeAllRanges();
                  composerRef.current?.focus();
                }}
              >
                {t("stepDetail.quote")}
              </button>
            )}
            <div className="mx-auto max-w-4xl">
              <div className="mb-5 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                <FileText className="h-4 w-4" />
                {onOpenDocument ? (
                  <button
                    type="button"
                    className="rounded-sm px-0.5 py-0.5 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    title={t("stepDetail.openDocumentInCode")}
                    onClick={onOpenDocument}
                  >
                    {t("stepDetail.document")}
                  </button>
                ) : (
                  <span>{t("stepDetail.document")}</span>
                )}
              </div>
              {artifact ? (
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <Markdown>{artifact}</Markdown>
                </div>
              ) : (
                <div className={`rounded-lg border border-dashed border-border bg-card/35 px-4 py-8 text-center text-sm ${emptyDocumentMessage ? "text-destructive" : "text-muted-foreground"}`}>
                  {isStreaming || isRunning
                    ? t("stepDetail.receivingOutput")
                    : emptyDocumentMessage || (isCheckpoint
                        ? t("stepDetail.noCheckpointDocument")
                        : t("stepDetail.noDocument"))}
                </div>
              )}
            </div>
          </div>
          {isAwaiting && isCheckpoint && (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-background px-6 py-3">
              {rejectOptions.map((target) => (
                <Button key={target} variant="outline" onClick={() => openRejectModal(target)}>
                  {t("stepDetail.rejectTo", { phase: phaseLabels?.[target] || target })}
                </Button>
              ))}
              <Button variant="success" onClick={onApprove}>{t("common.approve")}</Button>
            </div>
          )}
        </section>

        <aside className="flex min-h-0 flex-col overflow-hidden border-t border-border bg-card/45 xl:border-l xl:border-t-0">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <DetailIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="truncate text-sm font-semibold text-foreground">{currentBackend}</div>
            </div>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4" ref={conversationRef}>
            {conversation.length > 0 ? (
              conversation.map((item, idx) => (
                <ConversationItem key={item.id || `${item.type}-${idx}`} item={item} t={t} />
              ))
            ) : !showLoading ? (
              <div className="rounded-lg border border-dashed border-border bg-background/45 px-4 py-8 text-center text-sm text-muted-foreground">
                {t("stepDetail.noConversation")}
              </div>
            ) : null}
            {showLoading && <LoadingItem t={t} />}
          </div>

          {showComposer && (
            <form className="border-t border-border bg-background/80 px-4 py-3" onSubmit={handleSubmit}>
              {quotedText && (
                <div className="mb-3 flex items-start gap-2 rounded border border-border bg-accent px-2.5 py-2 text-xs">
                  <div className="line-clamp-3 flex-1 whitespace-pre-wrap text-muted-foreground">{quotedText}</div>
                  <button type="button" onClick={() => setQuotedText("")} className="shrink-0 text-muted-foreground hover:text-foreground">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              {images.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {images.map((img, i) => (
                    <div key={i} className="relative group">
                      <img src={img.preview} className="h-14 w-14 rounded border border-border object-cover" />
                      <button
                        type="button"
                        onClick={() => removeImage(i)}
                        className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => { addImageFiles(e.target.files); e.target.value = ""; }}
              />
              <div className="flex items-end gap-2">
                <textarea
                  ref={composerRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onPaste={handlePaste}
                  placeholder={t("stepDetail.inputPlaceholder")}
                  disabled={!canSend}
                  rows={1}
                  className="min-h-10 flex-1 resize-none rounded-md border border-input bg-card/70 px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring disabled:cursor-not-allowed disabled:opacity-50"
                />
                <Button type="submit" disabled={!canSend || (!input.trim() && images.length === 0)} className="shrink-0 px-3">
                  <Send className="h-4 w-4" />
                  {t("common.send")}
                </Button>
              </div>
            </form>
          )}
        </aside>
      </div>

      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 px-4 backdrop-blur-sm">
          <form
            className="w-full max-w-md rounded-lg border border-border bg-card p-4 shadow-lg"
            onSubmit={submitReject}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-foreground">
                  {t("stepDetail.rejectReasonTitle")}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("stepDetail.rejectReasonHint", { phase: phaseLabels?.[rejectTarget] || rejectTarget })}
                </p>
              </div>
              <button
                type="button"
                onClick={closeRejectModal}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label={t("common.close")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={5}
              autoFocus
              placeholder={t("stepDetail.rejectReasonPlaceholder")}
              className="min-h-28 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={closeRejectModal}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={!rejectReason.trim()}>
                {t("stepDetail.submitReject")}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
