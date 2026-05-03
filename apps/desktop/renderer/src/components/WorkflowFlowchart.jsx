import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "./i18n-provider";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";

function shortText(value, max = 22) {
  const text = String(value || "").trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function titleCase(value) {
  return String(value || "").replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function outputText(phase) {
  const outputs = Array.isArray(phase?.outputs) ? phase.outputs : [];
  if (phase?.type === "checkpoint") {
    const publish = Array.isArray(phase?.checkpoint?.publish) ? phase.checkpoint.publish : [];
    return publish.map((rule) => rule.asOutputKey || rule.filename).filter(Boolean).join(", ");
  }
  return outputs.map((output) => output.key || output.filename).filter(Boolean).join(", ");
}

function inputText(phase) {
  const inputs = Array.isArray(phase?.inputs) ? phase.inputs : [];
  return inputs.map((input) => input.name || input.outputKey).filter(Boolean).join(", ");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export default function WorkflowFlowchart({ phases, selectedIdx, onSelectPhase }) {
  const { t } = useI18n();
  const width = 940;
  const nodeX = 116;
  const nodeW = 172;
  const nodeH = 74;
  const agentX = 416;
  const agentW = 178;
  const docX = 690;
  const docW = 150;
  const stepY = 136;
  const startY = 42;
  const height = Math.max(520, startY + phases.length * stepY + 40);
  const viewportRef = useRef(null);
  const dragStateRef = useRef(null);
  const didDragRef = useRef(false);
  const panRef = useRef({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [zoomMode, setZoomMode] = useState("fit");
  const [dragging, setDragging] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const minZoom = 0.35;
  const maxZoom = 1.8;

  function getFitZoom(element) {
    if (!element) return 1;
    return clamp((element.clientWidth - 32) / width, minZoom, maxZoom);
  }

  function getFitPan(element, nextZoom) {
    if (!element) return { x: 16, y: 16 };
    const scaledWidth = width * nextZoom;
    return {
      x: Math.max((element.clientWidth - scaledWidth) / 2, 16),
      y: 16,
    };
  }

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    function applyFitZoom() {
      if (zoomMode === "fit") {
        const nextZoom = getFitZoom(element);
        const nextPan = getFitPan(element, nextZoom);
        panRef.current = nextPan;
        setZoom(nextZoom);
        setPan(nextPan);
      }
    }

    applyFitZoom();
    const observer = new ResizeObserver(applyFitZoom);
    observer.observe(element);
    return () => observer.disconnect();
  }, [zoomMode, phases.length]);

  function updateZoom(nextZoom) {
    setZoomMode("custom");
    setZoom((current) => clamp(typeof nextZoom === "function" ? nextZoom(current) : nextZoom, minZoom, maxZoom));
  }

  function zoomAtPoint(element, nextZoom, clientX, clientY) {
    const previousZoom = zoom;
    const clampedZoom = clamp(nextZoom, minZoom, maxZoom);
    if (clampedZoom === previousZoom) return;

    const rect = element.getBoundingClientRect();
    const pointerX = clientX - rect.left;
    const pointerY = clientY - rect.top;
    const currentPan = panRef.current;
    const contentX = (pointerX - currentPan.x) / previousZoom;
    const contentY = (pointerY - currentPan.y) / previousZoom;
    const nextPan = {
      x: pointerX - contentX * clampedZoom,
      y: pointerY - contentY * clampedZoom,
    };

    setZoomMode("custom");
    setZoom(clampedZoom);
    panRef.current = nextPan;
    setPan(nextPan);
  }

  function handleWheel(e) {
    const element = viewportRef.current;
    if (!element) return;

    const isPinchZoom = e.ctrlKey || e.metaKey;
    const isVerticalWheel = Math.abs(e.deltaY) > Math.abs(e.deltaX);
    if (!isPinchZoom && !isVerticalWheel) return;

    e.preventDefault();
    const delta = e.deltaY || e.deltaX;
    const factor = Math.exp(-delta * (isPinchZoom ? 0.01 : 0.0015));
    zoomAtPoint(element, zoom * factor, e.clientX, e.clientY);
  }

  function handlePointerDown(e) {
    if (e.button !== 0) return;
    const element = viewportRef.current;
    if (!element) return;

    dragStateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      panX: panRef.current.x,
      panY: panRef.current.y,
    };
    didDragRef.current = false;
    element.setPointerCapture(e.pointerId);
    setDragging(true);
  }

  function handlePointerMove(e) {
    const element = viewportRef.current;
    const dragState = dragStateRef.current;
    if (!element || !dragState || dragState.pointerId !== e.pointerId) return;

    const deltaX = e.clientX - dragState.startX;
    const deltaY = e.clientY - dragState.startY;
    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) didDragRef.current = true;

    const nextPan = {
      x: dragState.panX + deltaX,
      y: dragState.panY + deltaY,
    };
    panRef.current = nextPan;
    setPan(nextPan);
  }

  function stopDragging() {
    const element = viewportRef.current;
    const dragState = dragStateRef.current;
    if (element && dragState && element.hasPointerCapture(dragState.pointerId)) {
      element.releasePointerCapture(dragState.pointerId);
    }
    dragStateRef.current = null;
    setDragging(false);
    if (didDragRef.current) {
      setTimeout(() => {
        didDragRef.current = false;
      }, 0);
    }
  }

  function fitToWidth() {
    const element = viewportRef.current;
    const nextZoom = getFitZoom(element);
    const nextPan = getFitPan(element, nextZoom);
    setZoomMode("fit");
    setZoom(nextZoom);
    panRef.current = nextPan;
    setPan(nextPan);
  }

  useEffect(() => {
    panRef.current = pan;
  }, [pan]);

  if (phases.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t("flowchart.empty")}
      </div>
    );
  }

  const phaseY = (idx) => startY + idx * stepY;
  const centerY = (idx) => phaseY(idx) + nodeH / 2;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card/70">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-card/80 px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {zoomMode === "fit"
            ? t("flowchart.zoomFit", { percent: Math.round(zoom * 100) })
            : t("flowchart.zoomPercent", { percent: Math.round(zoom * 100) })}
        </span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 w-7 px-0"
            onClick={() => updateZoom((current) => current - 0.1)}
            disabled={zoom <= minZoom}
            aria-label={t("flowchart.zoomOut")}
            title={t("flowchart.zoomOut")}
          >
            -
          </Button>
          <Button
            type="button"
            variant={zoomMode === "fit" ? "default" : "outline"}
            size="sm"
            className="h-7 px-3"
            onClick={fitToWidth}
          >
            {t("flowchart.fit")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 w-7 px-0"
            onClick={() => updateZoom((current) => current + 0.1)}
            disabled={zoom >= maxZoom}
            aria-label={t("flowchart.zoomIn")}
            title={t("flowchart.zoomIn")}
          >
            +
          </Button>
        </div>
      </div>
      <div
        ref={viewportRef}
        className={cn(
          "relative min-h-0 flex-1 overflow-hidden select-none touch-none",
          dragging ? "cursor-grabbing" : "cursor-grab"
        )}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="absolute left-0 top-0 block max-w-none"
          style={{
            width: `${width}px`,
            height: `${height}px`,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "top left",
          }}
          role="img"
          aria-label={t("flowchart.aria")}
        >
          <defs>
            <pattern id="workflow-grid" width="18" height="18" patternUnits="userSpaceOnUse">
              <path d="M 18 0 L 0 0 0 18" fill="none" stroke="var(--border-color)" strokeWidth="0.7" opacity="0.7" />
            </pattern>
            <marker id="workflow-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--muted-fg)" />
            </marker>
            <marker id="workflow-reject-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--destructive)" />
            </marker>
          </defs>
          <rect x="0" y="0" width={width} height={height} rx="18" fill="var(--bg)" />
          <rect x="0" y="0" width={width} height={height} fill="url(#workflow-grid)" opacity="0.85" />

          {phases.slice(0, -1).map((phase, idx) => {
            const fromY = phaseY(idx) + nodeH;
            const toY = phaseY(idx + 1);
            return (
              <g key={`next-${phase.id || idx}`}>
                <path
                  d={`M ${nodeX + nodeW / 2} ${fromY} V ${toY - 8}`}
                  fill="none"
                  stroke="var(--muted-fg)"
                  strokeWidth="1.8"
                  markerEnd="url(#workflow-arrow)"
                />
                {phase.type === "checkpoint" && (
                  <text
                    x={nodeX + nodeW / 2 + 10}
                    y={(fromY + toY) / 2}
                    fill="var(--fg)"
                    fontSize="13"
                    fontWeight="600"
                  >
                    {t("flowchart.approve")}
                  </text>
                )}
              </g>
            );
          })}

          {phases.flatMap((phase, idx) => {
            if (phase.type !== "checkpoint") return [];
            return (phase.checkpoint?.rejectTargets || []).map((targetId, targetIdx) => {
              const targetPhaseIdx = phases.findIndex((item) => item.id === targetId);
              if (targetPhaseIdx < 0) return null;
              const laneX = nodeX - 34 - targetIdx * 22;
              const fromY = centerY(idx);
              const toY = centerY(targetPhaseIdx);
              const labelY = Math.min(fromY, toY) + Math.abs(fromY - toY) / 2 - 8;
              return (
                <g key={`reject-${phase.id || idx}-${targetId}`}>
                  <path
                    d={`M ${nodeX} ${fromY} H ${laneX} V ${toY} H ${nodeX - 8}`}
                    fill="none"
                    stroke="var(--destructive)"
                    strokeWidth="1.5"
                    strokeDasharray="5 5"
                    markerEnd="url(#workflow-reject-arrow)"
                  />
                  <text
                    x={laneX + 8}
                    y={labelY}
                    fill="var(--destructive)"
                    fontSize="12"
                    fontWeight="700"
                    textAnchor="start"
                  >
                    {t("editor.action.request_revision")}
                  </text>
                </g>
              );
            }).filter(Boolean);
          })}

          {phases.map((phase, idx) => {
            const y = phaseY(idx);
            const isSelected = idx === selectedIdx;
            const isAuto = phase.type === "auto";
            const label = phase.label || phase.id || t("editor.unnamed");
            const backend = phase.aiBackend === "codex" ? t("flowchart.codexInstance") : t("flowchart.claudeInstance");
            const inputSummary = inputText(phase) || "none";
            const outputSummary = outputText(phase) || "none";
            return (
              <g key={phase.id || idx}>
                <g
                  role="button"
                  tabIndex="0"
                  data-flow-node="true"
                  className="cursor-pointer"
                  onClick={() => {
                    if (!didDragRef.current) onSelectPhase(idx);
                  }}
                >
                  <rect
                    x={nodeX}
                    y={y}
                    width={nodeW}
                    height={nodeH}
                    rx="5"
                    fill={isSelected ? "var(--accent)" : "var(--card)"}
                    stroke={isSelected ? "var(--primary)" : "var(--fg)"}
                    strokeWidth={isSelected ? "2.4" : "1.4"}
                  />
                  <text
                    x={nodeX + nodeW / 2}
                    y={y + 31}
                    fill="var(--fg)"
                    fontSize="16"
                    fontWeight="700"
                    textAnchor="middle"
                  >
                    {shortText(label, 20)}
                  </text>
                  <text
                    x={nodeX + nodeW / 2}
                    y={y + 52}
                    fill="var(--muted-fg)"
                    fontSize="11"
                    fontWeight="600"
                    textAnchor="middle"
                  >
                    {phase.type === "checkpoint" ? t("flowchart.manualCheckpoint") : t("flowchart.aiRuns")}
                  </text>
                </g>

                <>
                  <path
                    d={`M ${nodeX + nodeW} ${centerY(idx)} H ${agentX - 12}`}
                    fill="none"
                    stroke="var(--muted-fg)"
                    strokeWidth="1.8"
                    markerEnd="url(#workflow-arrow)"
                  />
                  <text
                    x={(nodeX + nodeW + agentX) / 2}
                    y={centerY(idx) - 11}
                    fill="var(--fg)"
                    fontSize="12"
                    fontWeight="700"
                    textAnchor="middle"
                  >
                    {t("flowchart.consumes")}
                  </text>
                  <text
                    x={(nodeX + nodeW + agentX) / 2}
                    y={centerY(idx) + 11}
                    fill="var(--muted-fg)"
                    fontSize="11"
                    fontWeight="600"
                    textAnchor="middle"
                  >
                    {shortText(inputSummary, 24)}
                  </text>
                </>

                {isAuto ? (
                  <>
                    <text
                      x={(nodeX + nodeW + agentX) / 2}
                      y={centerY(idx) - 31}
                      fill="var(--fg)"
                      fontSize="13"
                      fontWeight="700"
                      textAnchor="middle"
                    >
                      {shortText(`${titleCase(label).toLowerCase()} ${t("flowchart.skillSuffix")}`, 22)}
                    </text>
                    <rect
                      x={agentX}
                      y={y}
                      width={agentW}
                      height={nodeH}
                      rx="5"
                      fill="var(--card)"
                      stroke="var(--fg)"
                      strokeWidth="1.4"
                    />
                    <text
                      x={agentX + agentW / 2}
                      y={y + 31}
                      fill="var(--fg)"
                      fontSize="15"
                      fontWeight="700"
                      textAnchor="middle"
                    >
                      {shortText(backend, 20)}
                    </text>
                    <text
                      x={agentX + agentW / 2}
                      y={y + 52}
                      fill="var(--muted-fg)"
                      fontSize="11"
                      fontWeight="600"
                      textAnchor="middle"
                    >
                      {t("flowchart.generatedStep")}
                    </text>
                  </>
                ) : (
                  <>
                    <rect
                      x={agentX}
                      y={y}
                      width={agentW}
                      height={nodeH}
                      rx="5"
                      fill="var(--card)"
                      stroke="var(--fg)"
                      strokeWidth="1.4"
                    />
                    <text
                      x={agentX + agentW / 2}
                      y={y + 28}
                      fill="var(--fg)"
                      fontSize="14"
                      fontWeight="700"
                      textAnchor="middle"
                    >
                      {t("flowchart.publishes")}
                    </text>
                    <text
                      x={agentX + agentW / 2}
                      y={y + 49}
                      fill="var(--muted-fg)"
                      fontSize="11"
                      fontWeight="600"
                      textAnchor="middle"
                    >
                      {shortText(outputSummary, 22)}
                    </text>
                  </>
                )}

                <path
                  d={`M ${agentX + agentW} ${centerY(idx)} H ${docX - 12}`}
                  fill="none"
                  stroke="var(--muted-fg)"
                  strokeWidth="1.8"
                  markerEnd="url(#workflow-arrow)"
                />
                <path
                  d={`M ${docX} ${y - 10} H ${docX + docW - 34} L ${docX + docW} ${y + 16} V ${y + nodeH + 18} H ${docX} Z`}
                  fill="var(--card)"
                  stroke="var(--fg)"
                  strokeWidth="1.4"
                />
                <path
                  d={`M ${docX + docW - 34} ${y - 10} V ${y + 16} H ${docX + docW}`}
                  fill="none"
                  stroke="var(--fg)"
                  strokeWidth="1.4"
                />
                <text
                  x={docX + docW / 2}
                  y={y + 25}
                  fill="var(--fg)"
                  fontSize="12"
                  fontWeight="700"
                  textAnchor="middle"
                >
                  {t("flowchart.produces")}
                </text>
                <text
                  x={docX + docW / 2}
                  y={y + 47}
                  fill="var(--fg)"
                  fontSize="13"
                  fontWeight="700"
                  textAnchor="middle"
                >
                  {shortText(outputSummary, 20)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
