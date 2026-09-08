import { Databases, IndexType, Permission, Role } from "node-appwrite";
import {
  ensureCollection,
  ensureStringAttribute,
  ensureIndex,
  waitForAttributesAvailable,
} from "../lib/db-helpers";
import { logger } from "../lib/logger";

const COLLECTION_ID =
  process.env.NEXT_PUBLIC_APPWRITE_AGENT_PROJECT_SECRETS_ID || "agent_project_secrets";
const COLLECTION_NAME = "Agent Project Secrets";

export async function setupAgentProjectSecrets(
  databases: Databases,
  databaseId: string,
): Promise<void> {
  logger.collection(COLLECTION_NAME);

  await ensureCollection(databases, databaseId, COLLECTION_ID, COLLECTION_NAME, [
    Permission.read(Role.any()),
  ]);

  await ensureStringAttribute(databases, databaseId, COLLECTION_ID, "userId", 256, true);
  await ensureStringAttribute(databases, databaseId, COLLECTION_ID, "projectId", 256, true);
  await ensureStringAttribute(databases, databaseId, COLLECTION_ID, "workspaceId", 256, true);
  await ensureStringAttribute(databases, databaseId, COLLECTION_ID, "name", 128, true);
  await ensureStringAttribute(databases, databaseId, COLLECTION_ID, "valueEncrypted", 16_384, true);

  await waitForAttributesAvailable(databases, databaseId, COLLECTION_ID, [
    "userId",
    "projectId",
    "workspaceId",
    "name",
    "valueEncrypted",
  ]);

  await ensureIndex(databases, databaseId, COLLECTION_ID, "projectId_idx", IndexType.Key, ["projectId"]);
  await ensureIndex(databases, databaseId, COLLECTION_ID, "project_name_idx", IndexType.Unique, [
    "projectId",
    "name",
  ]);
}
