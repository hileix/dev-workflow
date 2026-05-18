import { spawn } from "child_process";
import net from "net";
import { basename, join } from "path";
import { mkdirSync } from "fs";

type Options = {
  name: string;
  customName: boolean;
  portOffset: number;
  autoPortOffset: boolean;
};

const BASE_RENDERER_PORT = 5173;
const BASE_LOCAL_SERVER_PORT = 3000;
const BASE_BACKEND_PORT = 8787;
const MAX_PORT_OFFSET = 200;

function printUsage() {
  console.log("usage: pnpm dev:desktop:instance [--name <name>] [--port-offset <number>]");
}

function normalizeName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseArgs(argv: string[]): Options {
  let name = "";
  let customName = false;
  let portOffset = process.env.PORT_OFFSET ? Number(process.env.PORT_OFFSET) : 0;
  let autoPortOffset = !process.env.PORT_OFFSET;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--name") {
      name = argv[++index] || "";
      customName = true;
      continue;
    }
    if (arg.startsWith("--name=")) {
      name = arg.slice("--name=".length);
      customName = true;
      continue;
    }
    if (arg === "--port-offset") {
      portOffset = Number(argv[++index] || "");
      autoPortOffset = false;
      continue;
    }
    if (arg.startsWith("--port-offset=")) {
      portOffset = Number(arg.slice("--port-offset=".length));
      autoPortOffset = false;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  const normalizedName = normalizeName(name || basename(process.cwd()) || "desktop");
  if (!normalizedName) {
    throw new Error("instance name is required");
  }
  if (!Number.isInteger(portOffset) || portOffset < 0) {
    throw new Error("--port-offset must be a non-negative integer");
  }

  return { name: normalizedName, customName, portOffset, autoPortOffset };
}

function isPortOpen(port: number, host = "127.0.0.1") {
  return new Promise<boolean>((resolve) => {
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

function getPorts(portOffset: number) {
  return {
    rendererPort: BASE_RENDERER_PORT + portOffset,
    localServerPort: BASE_LOCAL_SERVER_PORT + portOffset,
    backendPort: BASE_BACKEND_PORT + portOffset,
  };
}

async function isPortOffsetAvailable(portOffset: number) {
  const ports = getPorts(portOffset);
  const occupied = await Promise.all([
    isPortOpen(ports.rendererPort),
    isPortOpen(ports.localServerPort),
    isPortOpen(ports.backendPort),
  ]);
  return occupied.every((value) => !value);
}

async function findAvailablePortOffset(startOffset: number) {
  for (let offset = startOffset; offset <= MAX_PORT_OFFSET; offset += 1) {
    if (await isPortOffsetAvailable(offset)) return offset;
  }
  throw new Error(`no available port offset found between ${startOffset} and ${MAX_PORT_OFFSET}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const portOffset = options.autoPortOffset
    ? await findAvailablePortOffset(options.portOffset)
    : options.portOffset;
  if (!options.autoPortOffset && !(await isPortOffsetAvailable(portOffset))) {
    throw new Error(`port offset ${portOffset} is already in use`);
  }
  const { rendererPort, localServerPort, backendPort } = getPorts(portOffset);
  const name = options.name;
  const userDataDir = options.customName
    ? join(process.cwd(), ".dev-instances", name)
    : process.env.DEV_WORKFLOW_USER_DATA_DIR || "";

  if (userDataDir) mkdirSync(userDataDir, { recursive: true });

  const env = {
    ...process.env,
    RENDERER_PORT: String(rendererPort),
    LOCAL_SERVER_PORT: String(localServerPort),
    PORT: String(localServerPort),
    BACKEND_PORT: String(backendPort),
    ELECTRON_RENDERER_URL: `http://127.0.0.1:${rendererPort}`,
    LOCAL_WORKFLOW_API_BASE: `http://127.0.0.1:${localServerPort}/api`,
    LOCAL_WORKFLOW_WS_URL: `ws://127.0.0.1:${localServerPort}/ws`,
    CLOUD_BACKEND_WS_URL: `ws://127.0.0.1:${backendPort}/ws/desktop`,
    DEVICE_ID: `desktop-${name}`,
    DEVICE_NAME: `Desktop ${name}`,
    DEV_WORKFLOW_INSTANCE_NAME: name,
  };
  if (userDataDir) env.DEV_WORKFLOW_USER_DATA_DIR = userDataDir;

  console.log(`[dev-instance] name: ${name}`);
  console.log(`[dev-instance] port offset: ${portOffset}${options.autoPortOffset ? " (auto)" : ""}`);
  console.log(`[dev-instance] renderer: http://127.0.0.1:${rendererPort}`);
  console.log(`[dev-instance] local server: http://127.0.0.1:${localServerPort}`);
  console.log(`[dev-instance] backend: http://127.0.0.1:${backendPort}`);
  console.log(`[dev-instance] user data: ${userDataDir || "default worktree-scoped directory"}`);

  const child = spawn("pnpm", ["run", "dev:all:raw"], {
    env,
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
  console.error(error?.message || error);
  printUsage();
  process.exit(1);
});
