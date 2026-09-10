/** Work items store membership ids, user ids, or both. Match any of them. */
export function assigneeIdSet(input: {
  userId?: string;
  memberships?: Array<{ $id?: string; userId?: string }>;
}): Set<string> {
  const ids = new Set<string>();
  const userId = input.userId?.trim();
  if (userId) ids.add(userId);
  for (const membership of input.memberships ?? []) {
    const membershipId = membership.$id?.trim();
    const memberUserId = membership.userId?.trim();
    if (membershipId) ids.add(membershipId);
    if (memberUserId) ids.add(memberUserId);
  }
  return ids;
}

export function workItemAssignedTo(item: { assigneeIds?: unknown }, ids: Set<string>): boolean {
  if (!ids.size) return false;
  const raw = item.assigneeIds;
  if (!Array.isArray(raw)) return false;
  return raw.some((value) => typeof value === "string" && ids.has(value.trim()));
}
