import { workflowStageGroups } from "./workflow-summary.js";

export const workflowStageById = Object.fromEntries(
  workflowStageGroups.map((group) => [group.id, group]),
);

