import {
  deleteAiApiProfile,
  readAiApiProfilesForUi,
  saveAiApiProfile,
} from "../repositories/config";
import { getWorkflow, getWorkflowConfigShape } from "../repositories/workflow";

export async function getWorkflowConfig() {
  const workflow = getWorkflow();
  const aiApiProfiles = await readAiApiProfilesForUi();
  if (!workflow) {
    return {
      ...getWorkflowConfigShape(null),
      aiApiProfiles,
    };
  }
  return {
    ...getWorkflowConfigShape(workflow),
    aiApiProfiles,
  };
}

export async function listAiApiProfiles() {
  return { profiles: await readAiApiProfilesForUi() };
}

export async function saveAiApi(profile) {
  const profiles = await saveAiApiProfile(profile);
  return { profiles };
}

export async function deleteAiApi(id) {
  const profiles = await deleteAiApiProfile(id);
  return { profiles };
}
