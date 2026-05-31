import { fileURLToPath } from "url";

import { killAllChildren } from "./runtime/claude.ts";
import { startDaemonConnection, stopDaemonConnection } from "./relay/client.ts";
import { startDiagnosticsServer } from "./diagnostics.ts";
import { migrateLegacyDesktopData } from "./repositories/migration.ts";

export { startDaemonConnection, stopDaemonConnection };
export { startDiagnosticsServer };

let diagnosticsServer = null;

export async function startDaemon() {
  const migration = await migrateLegacyDesktopData();
  if (migration.migrated) {
    console.log("[daemon] migrated legacy desktop data", migration.sources.filter((source) => source.migrated));
  }
  startDaemonConnection();
  diagnosticsServer = startDiagnosticsServer();
}

export function stopDaemon() {
  diagnosticsServer?.close();
  diagnosticsServer = null;
  stopDaemonConnection();
  killAllChildren();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.on("SIGINT", () => {
    stopDaemon();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    stopDaemon();
    process.exit(0);
  });
  startDaemon().catch((error) => {
    console.error(error);
    stopDaemon();
    process.exit(1);
  });
}
