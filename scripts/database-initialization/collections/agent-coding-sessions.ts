import { Databases, IndexType, Permission, Role } from "node-appwrite";
import {
  ensureCollection,
  ensureStringAttribute,
  ensureIndex,
  waitForAttributesAvailable,
} from "../lib/db-helpers";
import { logger } from "../lib/logger";

const COLLECTION_ID =
  process.env.NEXT_PUBLIC_APPWRITE_AGENT_CODING_SESSIONS_ID || "agent_coding_sessions";
const COLLECTION_NAME = "Agent Coding Sessions";

export async function setupAgentCodingSessions(
  databases: Databases,
  databaseId: string,
): Promise<void> {
  logger.collection(COLLECTION_NAME);

  await ensureCollection(databases, databaseId, COLLECTION_ID, COLLECTION_NAME, [
    Permission.read(Role.any()),
  ]);

  await ensureStringAttribute(databases, databaseId, COLLECTION_ID, "userId", 256, true);
  await ensureStringAttribute(databases, databaseId, COLLECTION_ID, "workItemId", 256, true);
  await ensureStringAttribute(databases, databaseId, COLLECTION_ID, "projectId", 256, true);
  await ensureStringAttribute(databases, databaseId, COLLECTION_ID, "workspaceId", 256, true);
  await ensureStringAttribute(databases, databaseId, COLLECTION_ID, "runId", 256, false);
  await ensureStringAttribute(databases, databaseId, COLLECTION_ID, "repoId", 256, false);
  await ensureStringAttribute(databases, databaseId, COLLECTION_ID, "baseBranch", 256, false);
  await ensureStringAttribute(databases, databaseId, COLLECTION_ID, "headBranch", 256, false);
  await ensureStringAttribute(databases, databaseId, COLLECTION_ID, "status", 32, true);
  await ensureStringAttribute(databases, databaseId, COLLECTION_ID, "sandboxId", 256, false);
  await ensureStringAttribute(databases, databaseId, COLLECTION_ID, "previewUrl", 2048, false);
  await ensureStringAttribute(databases, databaseId, COLLECTION_ID, "prNumber", 32, false);
  await ensureStringAttribute(databases, databaseId, COLLECTION_ID, "prUrl", 2048, false);
  await ensureStringAttribute(databases, databaseId, COLLECTION_ID, "orchestratorModelId", 256, false);
  await ensureStringAttribute(databases, databaseId, COLLECTION_ID, "workerModelId", 256, false);
  await ensureStringAttribute(databases, databaseId, COLLECTION_ID, "eventsJson", 1_048_576, true);

  await waitForAttributesAvailable(databases, databaseId, COLLECTION_ID, [
    "userId",
    "workItemId",
    "projectId",
    "status",
  ]);

  await ensureIndex(databases, databaseId, COLLECTION_ID, "userId_idx", IndexType.Key, ["userId"]);
  await ensureIndex(databases, databaseId, COLLECTION_ID, "workItemId_idx", IndexType.Key, [
    "workItemId",
  ]);
  await ensureIndex(databases, databaseId, COLLECTION_ID, "projectId_idx", IndexType.Key, [
    "projectId",
  ]);
  await ensureIndex(databases, databaseId, COLLECTION_ID, "runId_idx", IndexType.Key, ["runId"]);
}
