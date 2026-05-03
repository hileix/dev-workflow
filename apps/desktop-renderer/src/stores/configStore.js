import { create } from "zustand";
import { getAppApi } from "../lib/api-client";

const desktopApi = getAppApi();

export const useConfigStore = create((set, get) => ({
  workflowConfig: null,
  workflows: [],
  skills: [],
  activeWorkflowFile: "default.json",
  workFolders: [],
  selectedFolder: "",

  async loadAll() {
    get().loadWorkflowConfig();
    get().loadWorkflows();
    get().loadSkills();
    get().loadWorkFolders();
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

  async loadSkills() {
    try {
      const data = await desktopApi.listSkills();
      set({ skills: data.skills || [] });
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

  async saveSkill(skill) {
    try {
      const data = await desktopApi.saveSkill(skill);
      set({ skills: data.skills || [] });
    } catch {}
  },

  async deleteSkill(slug) {
    try {
      const data = await desktopApi.deleteSkill(slug);
      set({ skills: data.skills || [] });
    } catch {}
  },

  async importSkills() {
    try {
      const data = await desktopApi.importSkills();
      if (!data.cancelled) set({ skills: data.skills || [] });
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
