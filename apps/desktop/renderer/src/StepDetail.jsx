import { useState, useRef, useEffect, useCallback } from "react";
import Markdown from "react-markdown";
import { Paperclip, X } from "lucide-react";
import { Badge } from "./components/ui/badge";
import { useI18n } from "./components/i18n-provider";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { useWorkflowStore } from "./stores/workflowStore";
import { getAppApi } from "./lib/api-client";

const desktopApi = getAppApi();

export default function StepDetail({ phase, content, artifact, isStreaming, isRunning, isAwaiting, onApprove, onReject, onSendMessage, phaseLabels, phaseTypes, rejectTargets }) {
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const [images, setImages] = useState([]);
  const [quotedText, setQuotedText] = useState("");
  const [quoteButton, setQuoteButton] = useState(null);
  const contentRef = useRef(null);
  const aiResponseRef = useRef(null);
  const wasStreamingRef = useRef(false);
  const fileInputRef = useRef(null);
  const activeTicket = useWorkflowStore((s) => s.activeTicket);

  useEffect(() => {
    if ((isStreaming || isRunning) && aiResponseRef.current) {
      aiResponseRef.current.scrollTop = aiResponseRef.current.scrollHeight;
    }
  }, [content, isStreaming, isRunning]);

  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming && !isRunning && contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming, isRunning]);

  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!text || !contentRef.current?.contains(sel.anchorNode)) {
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
    for (const file of files) {
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

  async function handleSubmit(e) {
    e.preventDefault();
    let text = input.trim();
    if (!text && images.length === 0) return;

    if (quotedText) {
      const quoted = quotedText.split("\n").map((l) => `> ${l}`).join("\n");
      text = `${quoted}\n\n${text}`;
    }

    try {
      let uploadedPaths = [];
      if (images.length > 0 && activeTicket) {
        const payload = await Promise.all(images.map(async (img) => ({
          name: img.file.name,
          data: Array.from(new Uint8Array(await img.file.arrayBuffer())),
        })));
        const data = await desktopApi.saveTaskUploads(activeTicket, payload);
        uploadedPaths = data.paths || [];
      }

      setInput("");
      setImages([]);
      setQuotedText("");
      onSendMessage(text, uploadedPaths.length > 0 ? uploadedPaths : undefined);
    } catch {}
  }

  if (!phase) {
    return (
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
          {t("stepDetail.selectStep")}
        </div>
      </div>
    );
  }

  const isCheckpoint = phaseTypes?.[phase] === "checkpoint";
  const showChat = isStreaming || isRunning || (isAwaiting && !isCheckpoint);

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="flex items-center gap-3 border-b border-border bg-background/78 px-6 py-4">
        <h2 className="text-base font-semibold text-foreground">{phaseLabels?.[phase] || phase}</h2>
        {isStreaming && <Badge variant="info" className="animate-pulse-subtle">{t("stepDetail.streaming")}</Badge>}
        {!isStreaming && isRunning && <Badge variant="info" className="animate-pulse-subtle">{t("stepDetail.running")}</Badge>}
        {isAwaiting && <Badge variant="warning">{t("stepDetail.waitingForInput")}</Badge>}
      </div>

      <div className="relative flex-1 overflow-y-auto px-6 pb-6 pt-5 text-sm leading-relaxed" ref={contentRef}>
        {quoteButton && (
          <button
            className="absolute z-20 bg-foreground text-background text-xs px-2.5 py-1 rounded shadow-lg hover:opacity-80"
            style={{ top: quoteButton.top, left: quoteButton.left, transform: "translateX(-50%)" }}
            onMouseDown={(e) => {
              e.preventDefault();
              setQuotedText(quoteButton.text);
              setQuoteButton(null);
              window.getSelection()?.removeAllRanges();
            }}
          >
            {t("stepDetail.quote")}
          </button>
        )}
        {content ? (
          <>
            <details
              className="sticky top-0 z-10 overflow-hidden rounded-2xl border border-border bg-card/78 shadow-[0_1px_0_rgba(255,255,255,0.65)_inset]"
              open={isStreaming || isRunning || undefined}
            >
              <summary className="cursor-pointer select-none px-4 py-2.5 text-xs font-semibold text-muted-foreground hover:bg-accent/60 hover:text-foreground">
                {t("stepDetail.aiResponse")}
              </summary>
              <div
                className="max-h-[400px] overflow-y-auto border-t border-border px-4 py-4 bg-background/65"
                ref={aiResponseRef}
              >
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <Markdown>{content}</Markdown>
                </div>
                {isStreaming && (
                  <span className="inline-block w-2 h-4 bg-muted-foreground ml-0.5 align-text-bottom animate-cursor-blink" />
                )}
              </div>
            </details>
            {artifact ? (
              <div className="pt-6 prose prose-sm dark:prose-invert max-w-none">
                <Markdown>{artifact}</Markdown>
              </div>
            ) : !isStreaming && !isRunning ? (
              <div className="pt-6 text-muted-foreground italic">
                {t("stepDetail.noDocument")}
              </div>
            ) : null}
          </>
        ) : (
          <div className="pt-6 text-muted-foreground italic">
            {isStreaming ? t("stepDetail.receivingOutput") : t("stepDetail.noOutput")}
          </div>
        )}
      </div>

      {isAwaiting && isCheckpoint && (
        <div className="flex justify-center gap-3 border-t border-border bg-background px-6 py-3">
          <Button variant="success" onClick={onApprove}>{t("common.approve")}</Button>
          {rejectTargets?.[phase] && (
            <Button variant="destructive" onClick={() => onReject(rejectTargets[phase][0])}>{t("stepDetail.chatWithAi")}</Button>
          )}
        </div>
      )}

      {showChat && (
        <div className="border-t border-border bg-background">
          {quotedText && (
            <div className="mx-6 mt-3 flex items-start gap-2 p-2.5 bg-accent rounded border border-border text-xs">
              <div className="flex-1 text-muted-foreground whitespace-pre-wrap line-clamp-3">{quotedText}</div>
              <button onClick={() => setQuotedText("")} className="text-muted-foreground hover:text-foreground shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          {images.length > 0 && (
            <div className="flex gap-2 px-6 pt-3 flex-wrap">
              {images.map((img, i) => (
                <div key={i} className="relative group">
                  <img src={img.preview} className="w-16 h-16 object-cover rounded border border-border" />
                  <button
                    onClick={() => removeImage(i)}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <form className="flex items-center gap-3 px-6 py-4" onSubmit={handleSubmit}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => { addImageFiles(e.target.files); e.target.value = ""; }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-muted-foreground hover:text-foreground shrink-0"
            >
              <Paperclip className="w-5 h-5" />
            </button>
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={handlePaste}
              placeholder={t("stepDetail.inputPlaceholder")}
              disabled={isStreaming}
              autoFocus={isAwaiting && !isCheckpoint}
              className="flex-1"
            />
            <Button type="submit" disabled={isStreaming || (!input.trim() && images.length === 0)} className="shrink-0">
              {t("common.send")}
            </Button>
            {isAwaiting && !isCheckpoint && (
              <Button variant="success" onClick={onApprove} className="shrink-0">{t("common.approve")}</Button>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
