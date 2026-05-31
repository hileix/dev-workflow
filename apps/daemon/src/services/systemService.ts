import { spawn } from "child_process";

function spawnDetached(command, args) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    const child = spawn(command, args, {
      detached: true,
      env,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

const EDITOR_OPENERS = {
  code: {
    command: "code",
    args: (targetPath) => [targetPath],
    darwinApp: "Visual Studio Code",
    label: "VS Code",
  },
  sublime: {
    command: "subl",
    args: (targetPath) => [targetPath],
    darwinApp: "Sublime Text",
    label: "Sublime Text",
  },
  zed: {
    command: "zed",
    args: (targetPath) => [targetPath],
    darwinApp: "Zed",
    label: "Zed",
  },
};

export async function openPath(targetPath, editor = "code") {
  if (!targetPath) throw new Error("path required");
  const opener = EDITOR_OPENERS[editor] || EDITOR_OPENERS.code;
  try {
    await spawnDetached(opener.command, opener.args(targetPath));
    return { ok: true };
  } catch (error) {
    if (process.platform === "darwin") {
      await spawnDetached("open", ["-a", opener.darwinApp, targetPath]);
      return { ok: true };
    }
    throw new Error(error?.message || `failed to open ${opener.label}`);
  }
}
