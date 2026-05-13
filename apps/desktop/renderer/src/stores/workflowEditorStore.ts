import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

const NEW_WORKFLOW_EDITOR_KEY = "__new__";

export function getWorkflowEditorKey(filename) {
  return filename || NEW_WORKFLOW_EDITOR_KEY;
}

export const useWorkflowEditorStore = create()(
  persist(
    (set) => ({
      editorKey: "",
      workflow: null,
      currentFilename: null,
      selectedIdx: null,
      dirty: false,
      saving: false,
      error: "",

      initializeEditor({ filename, workflow, selectedIdx }) {
        set({
          editorKey: getWorkflowEditorKey(filename),
          workflow,
          currentFilename: filename || null,
          selectedIdx,
          dirty: false,
          saving: false,
          error: "",
        });
      },
      setWorkflow(updater) {
        set((state) => ({
          workflow: typeof updater === "function" ? updater(state.workflow) : updater,
        }));
      },
      setCurrentFilename(filename) {
        set({ currentFilename: filename || null });
      },
      setSelectedIdx(updater) {
        set((state) => ({
          selectedIdx: typeof updater === "function" ? updater(state.selectedIdx) : updater,
        }));
      },
      setDirty(dirty) {
        set({ dirty });
      },
      setSaving(saving) {
        set({ saving });
      },
      setError(error) {
        set({ error: error || "" });
      },
      resetEditor() {
        set({
          editorKey: "",
          workflow: null,
          currentFilename: null,
          selectedIdx: null,
          dirty: false,
          saving: false,
          error: "",
        });
      },
    }),
    {
      name: "workflow-editor-draft",
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        editorKey: state.editorKey,
        workflow: state.workflow,
        currentFilename: state.currentFilename,
        selectedIdx: state.selectedIdx,
        dirty: state.dirty,
      }),
    }
  )
);
