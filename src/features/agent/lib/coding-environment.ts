import { Databases, ID, Query } from "node-appwrite";

import { AGENT_CODING_ENVIRONMENTS_ID, DATABASE_ID } from "@/config";
import { parseJson, stringifyBounded } from "./truncate";

export type CodingEnvironment = {
  id: string;
  projectId: string;
  workspaceId: string;
  repoId?: string;
  runtime?: string;
  prepareScript?: string;
  startCommand?: string;
  exposePort?: number;
  envNames: string[];
};

type EnvDocument = {
  $id: string;
  projectId: string;
  workspaceId: string;
  repoId?: string;
  runtime?: string;
  prepareScript?: string;
  startCommand?: string;
  exposePort?: string;
  envNamesJson?: string;
};

function parseEnv(doc: EnvDocument): CodingEnvironment {
  const port = doc.exposePort ? Number(doc.exposePort) : undefined;
  return {
    id: doc.$id,
    projectId: doc.projectId,
    workspaceId: doc.workspaceId,
    repoId: doc.repoId || undefined,
    runtime: doc.runtime || undefined,
    prepareScript: doc.prepareScript || undefined,
    startCommand: doc.startCommand || undefined,
    exposePort: Number.isFinite(port) && (port || 0) > 0 ? port : undefined,
    envNames: parseJson<string[]>(doc.envNamesJson || "[]", []).filter((name) => typeof name === "string"),
  };
}

export async function getCodingEnvironment(
  databases: Databases,
  projectId: string,
): Promise<CodingEnvironment | null> {
  try {
    const listed = await databases.listDocuments(DATABASE_ID, AGENT_CODING_ENVIRONMENTS_ID, [
      Query.equal("projectId", projectId),
      Query.limit(1),
    ]);
    const doc = listed.documents[0];
    return doc ? parseEnv(doc as unknown as EnvDocument) : null;
  } catch {
    return null;
  }
}

export async function upsertCodingEnvironment(
  databases: Databases,
  input: {
    projectId: string;
    workspaceId: string;
    repoId?: string;
    runtime?: string;
    prepareScript?: string;
    startCommand?: string;
    exposePort?: number;
    envNames?: string[];
  },
): Promise<CodingEnvironment | null> {
  const payload = {
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    repoId: input.repoId || "",
    runtime: input.runtime || "",
    prepareScript: input.prepareScript || "",
    startCommand: input.startCommand || "",
    exposePort: input.exposePort != null ? String(input.exposePort) : "",
    envNamesJson: stringifyBounded(input.envNames ?? [], 4096),
  };
  try {
    const existing = await getCodingEnvironment(databases, input.projectId);
    if (existing) {
      const doc = await databases.updateDocument(DATABASE_ID, AGENT_CODING_ENVIRONMENTS_ID, existing.id, payload);
      return parseEnv(doc as unknown as EnvDocument);
    }
    const doc = await databases.createDocument(DATABASE_ID, AGENT_CODING_ENVIRONMENTS_ID, ID.unique(), payload);
    return parseEnv(doc as unknown as EnvDocument);
  } catch (error) {
    console.error("[agent] failed to save coding environment", error);
    return null;
  }
}
