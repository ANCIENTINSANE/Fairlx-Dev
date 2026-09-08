import type { AgentHarnessSettings, AgentPermissionType, AgentToolCall } from "../types";

const CODING_LOOP_TOOLS = new Set([
  "submit_implementation_plan",
  "coding_session_start",
  "coding_session_implement",
  "coding_session_browser",
  "github_open_pr",
  "github_merge_pr",
]);

export function autonomousCodingEnabled(input: {
  permissionType?: AgentPermissionType;
  settings?: Pick<AgentHarnessSettings, "permissionType" | "autonomousCoding">;
  runAutonomous?: boolean;
  mentionAuto?: boolean;
}): boolean {
  if (input.mentionAuto || input.runAutonomous) return true;
  const permission = input.permissionType ?? input.settings?.permissionType;
  if (permission === "all_access") return true;
  return input.settings?.autonomousCoding === true;
}

export function isCodingLoopTool(name: string): boolean {
  return CODING_LOOP_TOOLS.has(name);
}

export function skipCodingLoopConfirmation(call: AgentToolCall, autonomous: boolean): boolean {
  if (!autonomous) return false;
  return isCodingLoopTool(call.name);
}
