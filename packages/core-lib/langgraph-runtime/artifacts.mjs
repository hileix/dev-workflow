const DEFAULT_SUMMARY_MAX_LENGTH = 240;
const DEFAULT_PREVIEW_MAX_LENGTH = 800;

function stringifyContent(content) {
  if (content === undefined || content === null) return "";
  if (typeof content === "string") return content;
  return JSON.stringify(content, null, 2);
}

function truncateText(text, maxLength) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}...`;
}

export function createContentPreview(content, maxLength = DEFAULT_PREVIEW_MAX_LENGTH) {
  const text = stringifyContent(content).trim();
  if (!text) return "";
  return truncateText(text, maxLength);
}

export function createContentSummary(content, maxLength = DEFAULT_SUMMARY_MAX_LENGTH) {
  const text = stringifyContent(content).trim();
  if (!text) return "";

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const firstContentLine = lines.find((line) => !line.startsWith("#")) || lines[0] || "";
  const normalized = firstContentLine.replace(/^[-*]\s+/, "").replace(/\s+/g, " ");

  return truncateText(normalized, maxLength);
}

export function hasStepOutputResult(result) {
  return Boolean(result && (
    result.content !== undefined
    || result.summary
    || result.contentPreview
    || result.artifactPath
  ));
}

export function createStepOutputMetadata(result = {}) {
  return {
    kind: result.kind || "markdown",
    summary: result.summary || createContentSummary(result.content),
    contentPreview: result.contentPreview || createContentPreview(result.content),
    artifactPath: result.artifactPath || "",
    status: result.status || "ready",
  };
}

export function formatStepOutputForPrompt(stepId, output) {
  if (!output) return "";

  if (typeof output === "string") {
    const summary = createContentSummary(output);
    const contentPreview = createContentPreview(output);
    return [
      `## ${stepId}`,
      summary ? `Summary: ${summary}` : "",
      contentPreview ? ["", "Preview:", contentPreview].join("\n") : "",
    ].filter(Boolean).join("\n");
  }

  const lines = [
    `## ${stepId}`,
    output.status ? `Status: ${output.status}` : "",
    output.kind ? `Kind: ${output.kind}` : "",
    output.summary ? `Summary: ${output.summary}` : "",
    output.artifactPath ? `Artifact: ${output.artifactPath}` : "",
    output.contentPreview ? ["", "Preview:", output.contentPreview].join("\n") : "",
  ];

  return lines.filter(Boolean).join("\n");
}
