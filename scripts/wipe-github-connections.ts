import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { Client, Databases, Query } from "node-appwrite";

const client = new Client()
  .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
  .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT!)
  .setKey(process.env.NEXT_APPWRITE_KEY!);

const databases = new Databases(client);
const databaseId = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID || "fairlx";

const collections = [
  process.env.NEXT_PUBLIC_APPWRITE_GITHUB_ACCOUNTS_ID || "github_accounts",
  process.env.NEXT_PUBLIC_APPWRITE_GITHUB_REPOS_ID || "github_repositories",
  process.env.NEXT_PUBLIC_APPWRITE_GITHUB_EVENTS_ID || "github_events",
  process.env.NEXT_PUBLIC_APPWRITE_GITHUB_COMMITS_ID || "github_commits",
  process.env.NEXT_PUBLIC_APPWRITE_GITHUB_PRS_ID || "github_pull_requests",
  process.env.NEXT_PUBLIC_APPWRITE_GITHUB_ISSUES_ID || "github_issues",
  process.env.NEXT_PUBLIC_APPWRITE_GITHUB_RELEASES_ID || "github_releases",
];

async function wipeCollection(collectionId: string): Promise<number> {
  let deleted = 0;
  for (;;) {
    let listed;
    try {
      listed = await databases.listDocuments(databaseId, collectionId, [Query.limit(100)]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Skipping ${collectionId}: ${message}`);
      return deleted;
    }
    if (listed.documents.length === 0) return deleted;
    for (const doc of listed.documents) {
      await databases.deleteDocument(databaseId, collectionId, doc.$id);
      deleted += 1;
    }
  }
}

async function run() {
  console.log("Wiping GitHub account and project repository links…");
  for (const collectionId of collections) {
    const deleted = await wipeCollection(collectionId);
    console.log(`  ${collectionId}: deleted ${deleted}`);
  }
  console.log("Done. Connect GitHub from your Fairlx profile, then attach one repo per project from Integrations.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
