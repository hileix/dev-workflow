import { query } from "@anthropic-ai/claude-agent-sdk";
import { deleteManagedSkill, importManagedSkills, listManagedSkills, saveManagedSkill } from "../repositories/skills";

export async function generateSkill({ label, id, prompt, description }) {
  if (!label) throw new Error("label is required");

  const context = [
    `Phase label: ${label}`,
    id ? `Phase ID: ${id}` : "",
    prompt ? `Current prompt: ${prompt}` : "",
    description ? `User description: ${description}` : "",
  ].filter(Boolean).join("\n");

  const metaPrompt = `You are generating a skill instruction for a workflow automation phase. The skill will guide an AI assistant (Claude) on how to execute this phase.

Based on the following phase context, generate a concise, actionable skill instruction. The skill should describe what the AI should do, any constraints or best practices, and expected output format.

${context}

The output MUST start with YAML frontmatter containing name and description fields, followed by the skill body. Use this format:

---
name: <short kebab-case name derived from the phase label>
description: "<one-line description of what this skill does and when to use it>"
---

<skill instruction body>

Keep the skill body concise and actionable (under 500 words). No extra explanations outside the format above.`;

  let skill = "";
  for await (const message of query({
    prompt: metaPrompt,
    options: {
      cwd: process.cwd(),
      permissionMode: "default",
      maxTurns: 1,
    },
  })) {
    if (message.type === "result") {
      if (message.subtype !== "success") {
        throw new Error(message.errors?.join("; ") || message.result || "Failed to generate skill");
      }
      skill = message.result?.trim() || "";
    }
  }

  if (!skill) throw new Error("Failed to generate skill");
  return { skill };
}

export async function listSkills() {
  return { skills: await listManagedSkills() };
}

export async function saveSkill(skill) {
  await saveManagedSkill(skill);
  return listSkills();
}

export async function deleteSkill(slug) {
  await deleteManagedSkill(slug);
  return listSkills();
}

export async function importSkillsFromPaths(filePaths = []) {
  for (const filePath of filePaths) {
    await importManagedSkills(filePath);
  }
  return { skills: await listManagedSkills() };
}
