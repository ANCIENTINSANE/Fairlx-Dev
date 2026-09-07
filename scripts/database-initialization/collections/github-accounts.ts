import { Databases, IndexType, Permission, Role } from "node-appwrite";
import {
  ensureCollection,
  ensureStringAttribute,
  ensureDatetimeAttribute,
  ensureIndex,
  waitForAttributesAvailable,
} from "../lib/db-helpers";
import { logger } from "../lib/logger";

const COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_GITHUB_ACCOUNTS_ID || "github_accounts";
const COLLECTION_NAME = "GitHub Accounts";

export async function setupGithubAccounts(databases: Databases, databaseId: string): Promise<void> {
  logger.collection(COLLECTION_NAME);

  await ensureCollection(databases, databaseId, COLLECTION_ID, COLLECTION_NAME, [
    Permission.read(Role.any()),
  ]);

  await ensureStringAttribute(databases, databaseId, COLLECTION_ID, "userId", 256, true);
  await ensureStringAttribute(databases, databaseId, COLLECTION_ID, "githubLogin", 256, false);
  await ensureStringAttribute(databases, databaseId, COLLECTION_ID, "githubUserId", 64, false);
  await ensureStringAttribute(databases, databaseId, COLLECTION_ID, "accessToken", 2048, false);
  await ensureStringAttribute(databases, databaseId, COLLECTION_ID, "authMethod", 32, false, "oauth");
  await ensureStringAttribute(databases, databaseId, COLLECTION_ID, "scopes", 512, false);
  await ensureStringAttribute(databases, databaseId, COLLECTION_ID, "status", 32, false, "connected");
  await ensureDatetimeAttribute(databases, databaseId, COLLECTION_ID, "lastValidatedAt", false);

  await waitForAttributesAvailable(databases, databaseId, COLLECTION_ID, ["userId", "status"]);

  await ensureIndex(databases, databaseId, COLLECTION_ID, "userId_idx", IndexType.Unique, ["userId"]);
}
