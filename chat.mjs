import { spawn } from "child_process";
import * as readline from "readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(prompt) {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

async function chat(userMessage, sessionId) {
  const args = [
    "-p", userMessage,
    "--output-format", "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
  ];
  if (sessionId) {
    args.push("--resume", sessionId);
  }

  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let buffer = "";
    let resultSessionId = sessionId;

    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === "assistant" && event.message) {
            for (const block of event.message.content) {
              if (block.type === "text") {
                process.stdout.write(block.text);
              } else if (block.type === "tool_use") {
                process.stdout.write(`\n[tool: ${block.name}]\n`);
              }
            }
          } else if (event.type === "content_block_delta" && event.delta) {
            if (event.delta.type === "text_delta") {
              process.stdout.write(event.delta.text);
            }
          } else if (event.type === "result") {
            resultSessionId = event.session_id;
          }
        } catch {}
      }
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      if (!text.includes("Debug") && !text.includes("WARN")) {
        process.stderr.write(text);
      }
    });

    child.on("close", (code) => {
      process.stdout.write("\n\n");
      if (code === 0) {
        resolve(resultSessionId);
      } else {
        reject(new Error(`claude exited with code ${code}`));
      }
    });
  });
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
