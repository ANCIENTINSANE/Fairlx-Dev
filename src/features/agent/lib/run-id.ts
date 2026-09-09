/** Appwrite document ids: 1–36 chars, alphanumeric, period, hyphen, underscore. */
export const AGENT_RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/;

export function isAgentRunId(value: string): boolean {
  return AGENT_RUN_ID_PATTERN.test(value);
}
