import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const EMPTY_SKILL = {
  name: "",
  description: "",
  body: "",
};

function splitSkillContent(skill) {
  const content = skill?.content || "";
  const match = content.match(/^---\n[\s\S]*?\n---\n?/);
  return match ? content.slice(match[0].length).trim() : content.trim();
}

export default function SkillManager({ skills, onSave, onDelete, onImport }) {
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState(EMPTY_SKILL);
  const [error, setError] = useState("");

  function startNew() {
    setEditing(null);
    setDraft(EMPTY_SKILL);
    setError("");
  }

  function startEdit(skill) {
    setEditing(skill);
    setDraft({
      name: skill.name,
      description: skill.description || "",
      body: splitSkillContent(skill),
    });
    setError("");
  }

  async function save() {
    if (!draft.name.trim()) {
      setError("Skill name is required");
      return;
    }
    await onSave({
      ...draft,
      originalSlug: editing?.slug,
    });
    startNew();
  }

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-foreground">Skills</h3>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onImport}>Import</Button>
          <Button variant="outline" size="sm" onClick={startNew}>+ New Skill</Button>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] gap-4">
        <div>
          {skills.length === 0 ? (
            <div className="text-muted-foreground text-sm p-6 text-center border border-dashed border-border rounded-lg">
              No skills found.
            </div>
          ) : (
            <ul className="list-none space-y-2">
              {skills.map((skill) => (
                <li
                  key={skill.id}
                  className="flex items-center justify-between p-3 border border-border rounded-lg transition-colors hover:bg-accent"
                >
                  <button
                    type="button"
                    className="text-left min-w-0 flex-1"
                    onClick={() => startEdit(skill)}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-semibold text-foreground truncate">{skill.name}</span>
                    </div>
                    {skill.description && (
                      <span className="text-xs text-muted-foreground line-clamp-2">{skill.description}</span>
                    )}
                  </button>
                  <button
                    className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 p-1 rounded shrink-0"
                    onClick={() => onDelete(skill.slug)}
                    aria-label={`Remove ${skill.name}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border border-border rounded-lg p-3 bg-card space-y-3">
          <Input
            value={draft.name}
            onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
            placeholder="Skill name"
          />
          <Input
            value={draft.description}
            onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))}
            placeholder="Description"
          />
          <textarea
            value={draft.body}
            onChange={(event) => setDraft((prev) => ({ ...prev, body: event.target.value }))}
            placeholder="Skill instructions"
            className="flex w-full rounded-lg border border-input bg-secondary px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring min-h-[180px] resize-y font-mono"
            rows={8}
          />
          {error && <span className="block text-xs text-destructive">{error}</span>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={startNew}>Reset</Button>
            <Button size="sm" onClick={save}>{editing ? "Save Skill" : "Create Skill"}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
