import { create } from "zustand";
import { getDesktopApi } from "../lib/desktop-api";

const desktopApi = getDesktopApi();

export const useConfigStore = create((set, get) => ({
  workflowConfig: null,
  workflows: [],
  activeWorkflowFile: "default.json",
  workFolders: [],
  selectedFolder: "",
  taskStoragePath: "",

  async loadAll() {
    get().loadWorkflowConfig();
    get().loadWorkflows();
    get().loadWorkFolders();
    try {
      const config = await desktopApi.getConfig();
      set({ taskStoragePath: config.taskStoragePath || "" });
    } catch {}
  },

  async loadWorkflowConfig() {
    try {
      const workflowConfig = await desktopApi.getWorkflowConfig();
      set({ workflowConfig });
    } catch {}
  },

  async loadWorkflows() {
    try {
      const data = await desktopApi.listWorkflows();
      set({
        workflows: data.workflows || [],
        activeWorkflowFile: data.activeWorkflow || "default.json",
      });
    } catch {}
  },

  async loadWorkFolders() {
    try {
      const folders = await desktopApi.listWorkFolders();
      const updates = { workFolders: folders };
      if (folders.length > 0 && !get().selectedFolder) {
        updates.selectedFolder = folders[0].path;
      }
      set(updates);
    } catch {}
  },

  setSelectedFolder(path) {
    set({ selectedFolder: path });
  },

  async activateWorkflow(filename) {
    try {
      await desktopApi.activateWorkflow(filename);
      set({ activeWorkflowFile: filename });
      get().loadWorkflowConfig();
      get().loadWorkflows();
    } catch {}
  },

  async deleteWorkflow(filename) {
    try {
      await desktopApi.removeWorkflow(filename);
      get().loadWorkflows();
      get().loadWorkflowConfig();
    } catch {}
  },

  async changeStoragePath() {
    try {
      const pick = await desktopApi.pickFolder();
      if (pick.cancelled) return;
      const data = await desktopApi.updateTaskStoragePath(pick.path);
      set({ taskStoragePath: data.taskStoragePath });
      get().loadWorkFolders();
    } catch {}
  },

  async addFolder() {
    try {
      const pick = await desktopApi.pickFolder();
      if (pick.cancelled) return;
      const folders = await desktopApi.addWorkFolder(pick.path);
      set({ workFolders: folders, selectedFolder: pick.path });
    } catch {}
  },

  async removeFolder(path) {
    try {
      const folders = await desktopApi.removeWorkFolder(path);
      const updates = { workFolders: folders };
      if (get().selectedFolder === path) {
        updates.selectedFolder = folders.length > 0 ? folders[0].path : "";
      }
      set(updates);
    } catch {}
  },
}));
