import { basename, join } from "path";
import { cp, mkdir, readdir, readFile, rm, rename, stat, writeFile } from "fs/promises";
import { existsSync, readFileSync } from "fs";
import { getSkillsDir } from "./config.mjs";

const LEGACY_FORMATS = ["codex", "claude"];

function slugify(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function skillFile(slug) {
  const cleanSlug = slugify(slug);
  if (!cleanSlug) throw new Error("skill name is required");
  return join(getSkillsDir(), cleanSlug, "SKILL.md");
}

function legacySkillFile(format, slug) {
  const cleanSlug = slugify(slug);
  if (!cleanSlug) throw new Error("skill name is required");
  return join(getSkillsDir(), format, cleanSlug, "SKILL.md");
}

function parseFrontmatter(content) {
  const match = String(content || "").match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { name: "", description: "", body: String(content || "") };

  const meta = match[1];
  const name = meta.match(/^name:\s*["']?(.+?)["']?\s*$/m)?.[1] || "";
  const description = meta.match(/^description:\s*["']?([\s\S]*?)["']?\s*$/m)?.[1] || "";

  return {
    name,
    description,
    body: String(content || "").slice(match[0].length),
  };
}

function buildSkillContent({ name, description, body }) {
  const skillName = String(name || "").trim();
  const skillDescription = String(description || "").trim();
  const skillBody = String(body || "").trim();

  return [
    "---",
    `name: ${JSON.stringify(skillName)}`,
    `description: ${JSON.stringify(skillDescription)}`,
    "---",
    "",
    skillBody,
  ].join("\n").trimEnd() + "\n";
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
  const sourceSkillFile = join(sourceDir, "SKILL.md");
  const sourceStat = await stat(sourceSkillFile).catch(() => null);
  if (!sourceStat?.isFile()) throw new Error("skill folder must contain SKILL.md");

  const content = await readFile(sourceSkillFile, "utf-8");
  const meta = parseFrontmatter(content);
  const baseSlug = slugify(meta.name || basename(sourceDir));
  if (!baseSlug) throw new Error("skill name is required");

  let slug = baseSlug;
  let suffix = 2;
  while (existsSync(join(getSkillsDir(), slug))) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  const targetDir = join(getSkillsDir(), slug);
  await mkdir(getSkillsDir(), { recursive: true });
  await cp(sourceDir, targetDir, { recursive: true });
  return readSkill(slug);
}

async function readSkillFromFile(slug, file) {
  const content = await readFile(file, "utf-8");
  const meta = parseFrontmatter(content);

  return {
    id: slug,
    slug,
    name: meta.name || slug,
    description: meta.description || "",
    content,
  };
}

function readSkillFromFileSync(slug, file) {
  const content = readFileSync(file, "utf-8");
  const meta = parseFrontmatter(content);

  return {
    id: slug,
    slug,
    name: meta.name || slug,
    description: meta.description || "",
    content,
  };
}

async function readSkill(slug) {
  return readSkillFromFile(slug, skillFile(slug));
}

function readSkillSync(slug) {
  return readSkillFromFileSync(slug, skillFile(slug));
}

export async function listManagedSkills() {
  const root = getSkillsDir();
  const skills = [];

  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      skills.push(await readSkill(entry.name));
    } catch {}
  }

  const seen = new Set(skills.map((skill) => skill.slug));
  for (const format of LEGACY_FORMATS) {
    const formatDir = join(root, format);
    const legacyEntries = await readdir(formatDir, { withFileTypes: true }).catch(() => []);
    for (const entry of legacyEntries) {
      if (!entry.isDirectory() || seen.has(entry.name)) continue;
      try {
        skills.push(await readSkillFromFile(entry.name, legacySkillFile(format, entry.name)));
        seen.add(entry.name);
      } catch {}
    }
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export function readManagedSkillContentSync(ref) {
  const normalizedRef = String(ref || "");
  const slug = slugify(normalizedRef.includes(":") ? normalizedRef.split(":").pop() : normalizedRef);
  if (!slug) return "";
  try {
    return readSkillSync(slug).content;
  } catch {
    for (const format of LEGACY_FORMATS) {
      try {
        return readSkillFromFileSync(slug, legacySkillFile(format, slug)).content;
      } catch {}
    }
  }
  return "";
}

export async function saveManagedSkill(input) {
  const name = String(input?.name || "").trim();
  if (!name) throw new Error("skill name is required");

  const slug = slugify(name);
  const content = buildSkillContent({
    name,
    description: input?.description || "",
    body: input?.body || "",
  });

  const oldSlug = input?.originalSlug;
  if (oldSlug && slugify(oldSlug) !== slug) {
    const oldDir = join(getSkillsDir(), slugify(oldSlug));
    const newDir = join(getSkillsDir(), slug);
    const oldStat = await stat(oldDir).catch(() => null);
    if (oldStat?.isDirectory()) await rename(oldDir, newDir).catch(async () => {
      await rm(oldDir, { recursive: true, force: true });
    });
  }

  const file = skillFile(slug);
  await mkdir(join(getSkillsDir(), slug), { recursive: true });
  await writeFile(file, content);
  return readSkill(slug);
}

export async function deleteManagedSkill(slug) {
  const cleanSlug = slugify(slug);
  if (!cleanSlug) throw new Error("skill name is required");
  const dir = join(getSkillsDir(), cleanSlug);
  if (!existsSync(dir)) return;
  await rm(dir, { recursive: true, force: true });
}

export async function importManagedSkills(sourcePath) {
  const sourceDir = await sourceSkillDir(sourcePath);
  const sourceStat = await stat(join(sourceDir, "SKILL.md")).catch(() => null);

  if (sourceStat?.isFile()) {
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
