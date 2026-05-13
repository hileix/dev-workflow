import { spawn } from "child_process";
import { join } from "path";
import { mkdirSync } from "fs";

type Options = {
  name: string;
  portOffset: number;
};

const BASE_RENDERER_PORT = 5173;
const BASE_LOCAL_SERVER_PORT = 3000;
const BASE_BACKEND_PORT = 8787;

function printUsage() {
  console.log("usage: pnpm dev:desktop:instance --name <name> [--port-offset <number>]");
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
  let portOffset = Number(process.env.PORT_OFFSET || "0");

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--name") {
      name = argv[++index] || "";
      continue;
    }
    if (arg.startsWith("--name=")) {
      name = arg.slice("--name=".length);
      continue;
    }
    if (arg === "--port-offset") {
      portOffset = Number(argv[++index] || "");
      continue;
    }
    if (arg.startsWith("--port-offset=")) {
      portOffset = Number(arg.slice("--port-offset=".length));
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  const normalizedName = normalizeName(name);
  if (!normalizedName) {
    throw new Error("--name is required");
  }
  if (!Number.isInteger(portOffset) || portOffset < 0) {
    throw new Error("--port-offset must be a non-negative integer");
  }

  return { name: normalizedName, portOffset };
}

async function main() {
  const { name, portOffset } = parseArgs(process.argv.slice(2));
  const rendererPort = BASE_RENDERER_PORT + portOffset;
  const localServerPort = BASE_LOCAL_SERVER_PORT + portOffset;
  const backendPort = BASE_BACKEND_PORT + portOffset;
  const userDataDir = join(process.cwd(), ".dev-instances", name);

  mkdirSync(userDataDir, { recursive: true });

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
    DEV_WORKFLOW_USER_DATA_DIR: userDataDir,
  };

  console.log(`[dev-instance] name: ${name}`);
  console.log(`[dev-instance] renderer: http://127.0.0.1:${rendererPort}`);
  console.log(`[dev-instance] local server: http://127.0.0.1:${localServerPort}`);
  console.log(`[dev-instance] backend: http://127.0.0.1:${backendPort}`);
  console.log(`[dev-instance] user data: ${userDataDir}`);

  const child = spawn("pnpm", ["run", "dev:all"], {
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
