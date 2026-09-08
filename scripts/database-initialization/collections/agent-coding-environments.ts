import { Databases, IndexType, Permission, Role } from "node-appwrite";
import {
  ensureCollection,
  ensureStringAttribute,
  ensureIndex,
  waitForAttributesAvailable,
} from "../lib/db-helpers";
import { logger } from "../lib/logger";

const COLLECTION_ID =
  process.env.NEXT_PUBLIC_APPWRITE_AGENT_CODING_ENVIRONMENTS_ID || "agent_coding_environments";
const COLLECTION_NAME = "Agent Coding Environments";

export async function setupAgentCodingEnvironments(
  databases: Databases,
  databaseId: string,
): Promise<void> {
  logger.collection(COLLECTION_NAME);

  await ensureCollection(databases, databaseId, COLLECTION_ID, COLLECTION_NAME, [
    Permission.read(Role.any()),
  ]);

  await ensureStringAttribute(databases, databaseId, COLLECTION_ID, "projectId", 256, true);
  await ensureStringAttribute(databases, databaseId, COLLECTION_ID, "workspaceId", 256, true);
  await ensureStringAttribute(databases, databaseId, COLLECTION_ID, "repoId", 256, false);
  await ensureStringAttribute(databases, databaseId, COLLECTION_ID, "runtime", 64, false);
  await ensureStringAttribute(databases, databaseId, COLLECTION_ID, "prepareScript", 2048, false);
  await ensureStringAttribute(databases, databaseId, COLLECTION_ID, "startCommand", 2048, false);
  await ensureStringAttribute(databases, databaseId, COLLECTION_ID, "exposePort", 16, false);
  await ensureStringAttribute(databases, databaseId, COLLECTION_ID, "envNamesJson", 4096, false);

  await waitForAttributesAvailable(databases, databaseId, COLLECTION_ID, ["projectId", "workspaceId"]);

  await ensureIndex(databases, databaseId, COLLECTION_ID, "projectId_idx", IndexType.Unique, ["projectId"]);
}
