import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from "path";
import { access, cp, mkdir, stat } from "fs/promises";
import { execFile } from "child_process";

function execGit(args, cwd) {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile("git", args, { cwd }, (error, stdout, stderr) => {
      if (error) {
        const message = stderr?.trim() || stdout?.trim() || error.message;
        rejectPromise(new Error(message));
        return;
      }
      resolvePromise((stdout || "").trim());
    });
  });
}

function sanitizeNamePart(value, fallback) {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function normalizeMigrationFiles(files) {
  if (!Array.isArray(files)) return [];

  const seen = new Set();
  const result = [];
  for (const item of files) {
    const value = String(item || "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function assertSafeRelativePath(repoRoot, configuredPath) {
  if (isAbsolute(configuredPath)) {
    throw new Error(`worktree migration path must be relative: ${configuredPath}`);
  }

  const normalized = normalize(configuredPath);
  if (normalized === ".." || normalized.startsWith(`..${sep}`)) {
    throw new Error(`worktree migration path cannot escape the repository: ${configuredPath}`);
  }

  const sourcePath = resolve(repoRoot, normalized);
  const rel = relative(repoRoot, sourcePath);
  if (rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error(`worktree migration path cannot escape the repository: ${configuredPath}`);
  }

  return { normalizedPath: normalized, sourcePath };
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function branchExists(repoRoot, branchName) {
  try {
    await execGit(["rev-parse", "--verify", "--quiet", `refs/heads/${branchName}`], repoRoot);
    return true;
  } catch {
    return false;
  }
}

async function findAvailableWorktree(repoRoot, taskId) {
  const repoName = sanitizeNamePart(basename(repoRoot), "repo");
  const ticketSlug = sanitizeNamePart(taskId, "task");
  const parentDir = dirname(repoRoot);

  for (let index = 0; index < 50; index++) {
    const suffix = index === 0 ? "" : `-${index + 1}`;
    const dirName = `${repoName}-wt-${ticketSlug}${suffix}`;
    const branchName = `workflow/${ticketSlug}${suffix}`;
    const worktreePath = join(parentDir, dirName);

    if (await pathExists(worktreePath)) continue;
    if (await branchExists(repoRoot, branchName)) continue;

    return { worktreePath, branchName };
  }

  throw new Error(`could not find an available worktree name for ${taskId}`);
}

export function normalizeWorktreeConfig(worktree) {
  const enabled = Boolean(worktree?.enabled);
  const files = normalizeMigrationFiles(worktree?.files);
  const customFiles = normalizeMigrationFiles(worktree?.customFiles);
  const removeOnComplete = worktree?.removeOnComplete !== undefined ? Boolean(worktree.removeOnComplete) : false;
  return { enabled, files, customFiles, removeOnComplete };
}

export async function prepareWorktree({ repoRoot, taskId, worktree }) {
  const worktreeConfig = normalizeWorktreeConfig(worktree);
  if (!worktreeConfig.enabled) {
    return {
      enabled: false,
      sourceRoot: repoRoot,
      rootPath: null,
      workFolder: repoRoot,
      branchName: null,
      migratedFiles: [],
      skippedFiles: [],
      removeOnComplete: false,
    };
  }

  const repoStatus = await execGit(["rev-parse", "--show-toplevel"], repoRoot).catch(() => null);
  if (!repoStatus) {
    throw new Error("git worktree requires the selected work folder to be inside a Git repository");
  }

  const sourceRoot = repoStatus;
  const selectedSubdir = relative(sourceRoot, resolve(repoRoot));
  const { worktreePath, branchName } = await findAvailableWorktree(sourceRoot, taskId);
  await mkdir(dirname(worktreePath), { recursive: true });
  await execGit(["worktree", "add", "-b", branchName, worktreePath, "HEAD"], sourceRoot);

  const migratedFiles = [];
  const skippedFiles = [];

  try {
    for (const configuredPath of worktreeConfig.files) {
      const { normalizedPath, sourcePath } = assertSafeRelativePath(sourceRoot, configuredPath);
      const exists = await pathExists(sourcePath);
      if (!exists) {
        skippedFiles.push(normalizedPath);
        continue;
      }

      const sourceStat = await stat(sourcePath);
      const targetPath = join(worktreePath, normalizedPath);
      if (sourceStat.isDirectory()) {
        await mkdir(dirname(targetPath), { recursive: true });
        await cp(sourcePath, targetPath, { recursive: true, errorOnExist: false, force: true });
      } else {
        await mkdir(dirname(targetPath), { recursive: true });
        await cp(sourcePath, targetPath, { errorOnExist: false, force: true });
      }
      migratedFiles.push(normalizedPath);
    }
  } catch (err) {
    await removeWorktree({ enabled: true, sourceRoot, rootPath: worktreePath, branchName }, { force: true });
    throw err;
  }

  return {
    enabled: true,
    sourceRoot,
    rootPath: worktreePath,
    workFolder: selectedSubdir ? join(worktreePath, selectedSubdir) : worktreePath,
    branchName,
    migratedFiles,
    skippedFiles,
    removeOnComplete: worktreeConfig.removeOnComplete,
  };
}

export async function removeWorktree(worktreeState, options = {}) {
  if (!worktreeState?.enabled || !worktreeState.sourceRoot || !worktreeState.branchName || !worktreeState.rootPath) return false;

  const force = Boolean(options.force);
  const removeArgs = force
    ? ["worktree", "remove", "--force", worktreeState.rootPath]
    : ["worktree", "remove", worktreeState.rootPath];
  const branchArgs = force
    ? ["branch", "-D", worktreeState.branchName]
    : ["branch", "-d", worktreeState.branchName];

  await execGit(removeArgs, worktreeState.sourceRoot).catch(() => {});
  await execGit(branchArgs, worktreeState.sourceRoot).catch(() => {});
  return true;
}
