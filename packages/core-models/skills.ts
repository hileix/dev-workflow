import { basename, join } from "path";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "fs/promises";
import { existsSync, readFileSync } from "fs";
import { getSkillsDir } from "./config";

function slugify(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeContent(content) {
  return String(content || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n");
}

function skillDir(slug) {
  const cleanSlug = slugify(slug);
  if (!cleanSlug) throw new Error("skill name is required");
  return join(getSkillsDir(), cleanSlug);
}

function skillFile(slug) {
  return join(skillDir(slug), "SKILL.md");
}

function parseSkillContent(content) {
  const normalized = normalizeContent(content);
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return {
      name: "",
      description: "",
      body: normalized.trim(),
      content: normalized,
    };
  }

  const meta = match[1];
  const body = normalized.slice(match[0].length).trim();
  return {
    name: meta.match(/^name:\s*["']?(.+?)["']?\s*$/m)?.[1]?.trim() || "",
    description: meta.match(/^description:\s*["']?(.+?)["']?\s*$/m)?.[1]?.trim() || "",
    body,
    content: normalized,
  };
}

function buildSkillContent({ name, description, body }) {
  const skillName = String(name || "").trim();
  const skillDescription = String(description || "").trim();
  const skillBody = String(body || "").trim();

  if (!skillName) throw new Error("skill name is required");

  return [
    "---",
    `name: ${JSON.stringify(skillName)}`,
    `description: ${JSON.stringify(skillDescription)}`,
    "---",
    "",
    skillBody,
    "",
  ].join("\n");
}

const DEFAULT_MANAGED_SKILLS = [
  {
    slug: "worktree-naming",
    name: "worktree-naming",
    description: "Generate Git branch and worktree names for workflow runs.",
    body: [
      "Choose a concise Git branch name for this workflow run.",
      "",
      "Rules:",
      "- Return exactly one name and no explanation.",
      "- Use Conventional Commits style as a branch prefix: feat/, fix/, docs/, refactor/, test/, chore/, perf/, ci/, build/, or style/.",
      "- Use lowercase kebab-case after the prefix.",
      "- Keep it under 48 characters when practical.",
      "- Prefer the task intent over generic words.",
    ].join("\n"),
  },
];

async function ensureDefaultManagedSkills() {
  await mkdir(getSkillsDir(), { recursive: true });
  for (const skill of DEFAULT_MANAGED_SKILLS) {
    const targetFile = skillFile(skill.slug);
    if (existsSync(targetFile)) continue;
    await mkdir(skillDir(skill.slug), { recursive: true });
    await writeFile(targetFile, buildSkillContent(skill));
  }
}

async function readSkill(slug) {
  const content = await readFile(skillFile(slug), "utf-8");
  const parsed = parseSkillContent(content);

  return {
    id: slug,
    slug,
    name: parsed.name || slug,
    description: parsed.description || "",
    body: parsed.body || "",
    content: buildSkillContent({
      name: parsed.name || slug,
      description: parsed.description || "",
      body: parsed.body || "",
    }),
  };
}

async function sourceSkillDir(sourcePath) {
  const sourceStat = await stat(sourcePath).catch(() => null);
  if (!sourceStat) throw new Error("skill path does not exist");

  if (sourceStat.isFile()) {
    if (basename(sourcePath) !== "SKILL.md") throw new Error("select a SKILL.md file or skill folder");
    return join(sourcePath, "..");
  }

  if (!sourceStat.isDirectory()) throw new Error("select a SKILL.md file or skill folder");
  return sourcePath;
}

async function copySkillDir(sourceDir) {
  const sourceFile = join(sourceDir, "SKILL.md");
  const sourceStat = await stat(sourceFile).catch(() => null);
  if (!sourceStat?.isFile()) throw new Error("skill folder must contain SKILL.md");

  const parsed = parseSkillContent(await readFile(sourceFile, "utf-8"));
  const baseSlug = slugify(parsed.name || basename(sourceDir));
  if (!baseSlug) throw new Error("skill name is required");

  let slug = baseSlug;
  let suffix = 2;
  while (existsSync(skillDir(slug))) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  await mkdir(getSkillsDir(), { recursive: true });
  await cp(sourceDir, skillDir(slug), { recursive: true });
  return readSkill(slug);
}

export async function listManagedSkills() {
  await ensureDefaultManagedSkills();
  const root = getSkillsDir();
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const skills = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      skills.push(await readSkill(entry.name));
    } catch {}
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export function readManagedSkillContentSync(ref) {
  const slug = slugify(ref);
  if (!slug) return "";
  try {
    const content = readFileSync(skillFile(slug), "utf-8");
    const parsed = parseSkillContent(content);
    return buildSkillContent({
      name: parsed.name || slug,
      description: parsed.description || "",
      body: parsed.body || "",
    });
  } catch {
    return "";
  }
}

export async function saveManagedSkill(input) {
  const name = String(input?.name || "").trim();
  const description = String(input?.description || "").trim();
  const body = String(input?.body || "").trim();
  const oldSlug = slugify(input?.originalSlug || name);
  const slug = slugify(name);

  if (!name) throw new Error("skill name is required");
  if (!slug) throw new Error("skill name is required");

  const content = buildSkillContent({ name, description, body });
  const targetDir = skillDir(slug);
  const targetFile = skillFile(slug);
  const oldDir = oldSlug ? skillDir(oldSlug) : "";

  await mkdir(getSkillsDir(), { recursive: true });

  if (oldDir && oldDir !== targetDir && existsSync(oldDir)) {
    if (existsSync(targetDir)) {
      throw new Error("skill with this name already exists");
    }
    await rm(oldDir, { recursive: true, force: true });
  }

  await mkdir(targetDir, { recursive: true });
  await writeFile(targetFile, content);
  return readSkill(slug);
}

export async function deleteManagedSkill(slug) {
  const cleanSlug = slugify(slug);
  if (!cleanSlug) throw new Error("skill name is required");
  await rm(skillDir(cleanSlug), { recursive: true, force: true });
}

export async function importManagedSkills(sourcePath) {
  const sourceDir = await sourceSkillDir(sourcePath);
  const directSkill = await stat(join(sourceDir, "SKILL.md")).catch(() => null);

  if (directSkill?.isFile()) {
    return [await copySkillDir(sourceDir)];
  }

  const imported = [];
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      imported.push(await copySkillDir(join(sourceDir, entry.name)));
    } catch {}
  }

  if (imported.length === 0) throw new Error("no skills found to import");
  return imported;
}
