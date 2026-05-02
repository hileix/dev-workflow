import express from "express";
import cors from "cors";
import { createServer } from "http";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

import "./models/workflow.mjs"; // triggers startup workflow loading
import workfoldersController from "./controllers/workfoldersController.mjs";
import workflowController from "./controllers/workflowController.mjs";
import { setupWebSocket } from "./controllers/wsController.mjs";
import { activeWorkflows } from "./lib/claude.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, "renderer", "dist")));

app.use("/api", workfoldersController);
app.use("/api", workflowController);

// SPA fallback
app.get("*", (req, res) => {
  res.sendFile(join(__dirname, "renderer", "dist", "index.html"));
});

function killAllChildren() {
  for (const [, wf] of activeWorkflows) {
    if (wf.abortController) {
      try { wf.abortController.abort(); } catch {}
      wf.abortController = null;
    }
  }
}

export function startServer(port = PORT, host) {
  const server = createServer(app);
  setupWebSocket(server);

  return new Promise((resolve, reject) => {
    const listenArgs = host ? [port, host] : [port];
    const onError = (err) => reject(err);
    server.once("error", onError);
    server.listen(...listenArgs, () => {
      server.off("error", onError);
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      console.log(`Server running at http://localhost:${actualPort}`);
      resolve({ app, server, port: actualPort });
    });
  });
}

export { killAllChildren };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.on("SIGINT", () => { killAllChildren(); process.exit(0); });
  process.on("SIGTERM", () => { killAllChildren(); process.exit(0); });
  startServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
