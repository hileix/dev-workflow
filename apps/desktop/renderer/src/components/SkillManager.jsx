import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useI18n } from "./i18n-provider";
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
  const { t } = useI18n();
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
      setError(t("skillManager.nameRequired"));
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
        <h3 className="text-[15px] font-semibold text-foreground">{t("skillManager.title")}</h3>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onImport}>{t("skillManager.import")}</Button>
          <Button variant="outline" size="sm" onClick={startNew}>{t("skillManager.new")}</Button>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] gap-4">
        <div>
          {skills.length === 0 ? (
            <div className="text-muted-foreground text-sm p-6 text-center border border-dashed border-border rounded-xl bg-card/50">
              {t("skillManager.noSkills")}
            </div>
          ) : (
            <ul className="list-none divide-y divide-border overflow-hidden rounded-xl border border-border bg-card/70">
              {skills.map((skill) => (
                <li
                  key={skill.id}
                  className="flex items-center justify-between px-4 py-3.5 transition-colors hover:bg-accent/70"
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

        <div className="border border-border rounded-xl p-3 bg-card/70 space-y-3">
          <Input
            value={draft.name}
            onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
            placeholder={t("skillManager.namePlaceholder")}
          />
          <Input
            value={draft.description}
            onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))}
            placeholder={t("skillManager.descriptionPlaceholder")}
          />
          <textarea
            value={draft.body}
            onChange={(event) => setDraft((prev) => ({ ...prev, body: event.target.value }))}
            placeholder={t("skillManager.instructionsPlaceholder")}
            className="flex w-full rounded-md border border-input bg-card/70 px-3 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring min-h-[180px] resize-y font-mono"
            rows={8}
          />
          {error && <span className="block text-xs text-destructive">{error}</span>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={startNew}>{t("skillManager.reset")}</Button>
            <Button size="sm" onClick={save}>{editing ? t("skillManager.save") : t("skillManager.create")}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
