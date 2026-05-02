import * as readline from "readline";
import { query } from "@anthropic-ai/claude-agent-sdk";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(prompt) {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

async function chat(userMessage, sessionId) {
  let resultSessionId = sessionId;

  for await (const message of query({
    prompt: userMessage,
    options: {
      cwd: process.cwd(),
      resume: sessionId || undefined,
      includePartialMessages: true,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      systemPrompt: { type: "preset", preset: "claude_code" },
      tools: { type: "preset", preset: "claude_code" },
      settingSources: ["user", "project", "local"],
    },
  })) {
    if (message.type === "stream_event") {
      const inner = message.event;
      if (inner.type === "content_block_delta" && inner.delta?.type === "text_delta") {
        process.stdout.write(inner.delta.text);
      } else if (inner.type === "content_block_start" && inner.content_block?.type === "tool_use") {
        process.stdout.write(`\n[tool: ${inner.content_block.name}]\n`);
      }
      continue;
    }

    if (message.type === "result") {
      if (message.session_id) resultSessionId = message.session_id;
      if (message.subtype !== "success") {
        throw new Error(message.errors?.join("; ") || message.result || "Claude run failed");
      }
    }
  }

  process.stdout.write("\n\n");
  return resultSessionId;
}

console.log("Chat with Claude Code");
console.log("Full Claude Code capabilities (bash, file edit, etc.)");
console.log('Type "exit" to quit.\n');

let sessionId = null;

while (true) {
  const input = await ask("You: ");
  if (input.trim().toLowerCase() === "exit") break;
  if (!input.trim()) continue;
  try {
    process.stdout.write("\nClaude: ");
    sessionId = await chat(input, sessionId);
  } catch (err) {
    console.error(`\nError: ${err.message}\n`);
  }
}

rl.close();
