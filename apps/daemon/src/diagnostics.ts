import { createServer } from "http";

export function startDiagnosticsServer(options: { port?: number; host?: string } = {}) {
  const port = options.port || Number(process.env.DAEMON_DIAGNOSTICS_PORT || 0);
  if (!port) return null;

  const host = options.host || process.env.DAEMON_DIAGNOSTICS_HOST || "127.0.0.1";
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  server.listen(port, host, () => {
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : port;
    console.log(`[daemon] diagnostics running at http://${host}:${actualPort}`);
  });

  return server;
}
