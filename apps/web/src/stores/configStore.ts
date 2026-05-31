import { create } from "zustand";
import { getAppApi } from "../lib/api-client";

const appApi = getAppApi();

export const useConfigStore = create((set, get) => ({
  workflowConfig: null,
  workflows: [],
  skills: [],
  aiApiProfiles: [],
  activeWorkflowFile: "",
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
      const workflowConfig = await appApi.getWorkflowConfig();
      set({ workflowConfig, aiApiProfiles: workflowConfig?.aiApiProfiles || [] });
    } catch {}
  },

  async saveAiApiProfile(profile) {
    const data = await appApi.saveAiApiProfile(profile);
    set({ aiApiProfiles: data.profiles || [] });
    get().loadWorkflowConfig();
    return data;
  },

  async deleteAiApiProfile(id) {
    const data = await appApi.deleteAiApiProfile(id);
    set({ aiApiProfiles: data.profiles || [] });
    get().loadWorkflowConfig();
    return data;
  },

  async loadWorkflows() {
    try {
      const data = await appApi.listWorkflows();
      set({
        workflows: data.workflows || [],
        activeWorkflowFile: data.activeWorkflow || "",
      });
    } catch {}
  },

  async loadSkills() {
    try {
      const data = await appApi.listSkills();
      set({ skills: data.skills || [] });
    } catch {}
  },

  async loadWorkFolders() {
    try {
      const folders = await appApi.listWorkFolders();
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
      await appApi.activateWorkflow(filename);
      set({ activeWorkflowFile: filename });
      get().loadWorkflowConfig();
      get().loadWorkflows();
    } catch {}
  },

  async deleteWorkflow(filename) {
    try {
      await appApi.removeWorkflow(filename);
      get().loadWorkflows();
      get().loadWorkflowConfig();
    } catch {}
  },

  async setWorkflowVisible(filename, visible) {
    const previousWorkflows = get().workflows;
    const workflow = previousWorkflows.find((item) => item.filename === filename);
    if (!workflow) return;

    set({
      workflows: previousWorkflows.map((item) =>
        item.filename === filename ? { ...item, visible } : item
      ),
    });

    try {
      await appApi.setWorkflowVisible(filename, visible);
      get().loadWorkflows();
      get().loadWorkflowConfig();
    } catch (error) {
      set({ workflows: previousWorkflows });
      throw error;
    }
  },

  async saveSkill(skill) {
    try {
      const data = await appApi.saveSkill(skill);
      set({ skills: data.skills || [] });
      return data;
    } catch (error) {
      throw error;
    }
  },

  async deleteSkill(slug) {
    try {
      const data = await appApi.deleteSkill(slug);
      set({ skills: data.skills || [] });
    } catch {}
  },

  async importSkills() {
    try {
      const data = await appApi.importSkills();
      if (!data.cancelled) set({ skills: data.skills || [] });
    } catch {}
  },

  async addFolder() {
    try {
      const pick = await appApi.pickFolder();
      if (pick.cancelled) return;
      const folders = await appApi.addWorkFolder(pick.path);
      set({ workFolders: folders, selectedFolder: pick.path });
    } catch {}
  },

  async removeFolder(path) {
    try {
      const folders = await appApi.removeWorkFolder(path);
      const updates = { workFolders: folders };
      if (get().selectedFolder === path) {
        updates.selectedFolder = folders.length > 0 ? folders[0].path : "";
      }
      set(updates);
    } catch {}
  },
}));
