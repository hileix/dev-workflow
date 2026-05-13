import net from "net";
import { spawn } from "child_process";

function isPortOpen(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      resolve(false);
    });
  });
}

async function main() {
  const [, , portArg, ...command] = process.argv;
  const port = Number(portArg);

  if (!port || command.length === 0) {
    console.error("usage: node scripts/run-if-port-free.ts <port> <command> [args...]");
    process.exit(1);
  }

  const occupied = await isPortOpen(port);
  if (occupied) {
    console.log(`[dev-stack] Reusing existing service on port ${port}.`);
    process.on("SIGINT", () => process.exit(0));
    process.on("SIGTERM", () => process.exit(0));
    setInterval(() => {}, 1 << 30);
    return;
  }

  const child = spawn(command[0], command.slice(1), {
    stdio: "inherit",
    shell: false,
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
