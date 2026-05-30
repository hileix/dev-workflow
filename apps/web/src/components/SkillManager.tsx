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

export default function SkillManager({ skills, onSave, onDelete, onImport }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState(EMPTY_SKILL);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  function startNew() {
    setEditing(null);
    setDraft(EMPTY_SKILL);
    setError("");
    setOpen(true);
  }

  function startEdit(skill) {
    setEditing(skill);
    setDraft({
      name: skill.name || "",
      description: skill.description || "",
      body: skill.body || "",
    });
    setError("");
    setOpen(true);
  }

  function closeModal() {
    setEditing(null);
    setDraft(EMPTY_SKILL);
    setError("");
    setOpen(false);
  }

  async function save() {
    if (!draft.name.trim()) {
      setError(t("skillManager.nameRequired"));
      return;
    }
    try {
      setError("");
      await onSave({
        ...draft,
        originalSlug: editing?.slug,
      });
      closeModal();
    } catch (error) {
      setError(error?.message || t("skillManager.saveFailed"));
    }
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

      {skills.length === 0 ? (
        <div className="text-muted-foreground text-sm p-6 text-center border border-dashed border-border rounded-xl bg-card/50">
          {t("skillManager.noSkills")}
        </div>
      ) : (
        <ul className="list-none divide-y divide-border overflow-hidden rounded-md border border-border bg-card">
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

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onClick={closeModal}
        >
          <div
            className="w-full max-w-3xl rounded-md border border-border bg-card p-4 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-foreground">
                  {editing ? t("skillManager.editTitle") : t("skillManager.createTitle")}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("skillManager.modalHint")}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={closeModal}>{t("common.close")}</Button>
            </div>

            <div className="mb-3 grid gap-3">
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
            </div>
            <textarea
              value={draft.body}
              onChange={(event) => setDraft((prev) => ({ ...prev, body: event.target.value }))}
              placeholder={t("skillManager.instructionsPlaceholder")}
              className="flex min-h-[420px] w-full resize-y rounded-md border border-input bg-card px-4 py-3 font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
              rows={18}
            />
            {error && <span className="mt-2 block text-xs text-destructive">{error}</span>}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={closeModal}>{t("common.cancel")}</Button>
              <Button size="sm" onClick={save}>{editing ? t("skillManager.save") : t("skillManager.create")}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
