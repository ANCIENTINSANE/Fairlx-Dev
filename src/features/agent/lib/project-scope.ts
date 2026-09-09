/**
 * `null` / `""` means the user cleared the project so the agent can create one.
 * `undefined` means inherit the run or harness default.
 */
export function resolveAgentProjectId(
  selected: string | null | undefined,
  fallbacks: Array<string | undefined> = [],
): string | undefined {
  if (selected === null || selected === "") return undefined;
  if (selected) return selected;
  for (const id of fallbacks) {
    if (id) return id;
  }
  return undefined;
}
