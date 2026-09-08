import { Databases, ID, Query } from "node-appwrite";

import { AGENT_PROJECT_SECRETS_ID, DATABASE_ID } from "@/config";
import { encryptSecret, decryptSecret, isEncryptionConfigured } from "./secrets";
import { redactSecrets } from "./sandbox/types";

const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]{1,127}$/;

export function isProjectSecretName(name: string): boolean {
  return SECRET_NAME_RE.test(name.trim());
}

export function encryptProjectSecretValue(plaintext: string): string {
  return encryptSecret(plaintext);
}

export function decryptProjectSecretValue(stored: string): string {
  return decryptSecret(stored);
}

export function projectSecretsConfigured(): boolean {
  return isEncryptionConfigured();
}

export function redactSecretMap(text: string, secrets: Record<string, string>): string {
  return redactSecrets(text, Object.values(secrets));
}

export function publicSecretNames(names: string[]): string[] {
  return names.filter((name) => isProjectSecretName(name));
}

export type ProjectSecretPublic = {
  id: string;
  projectId: string;
  name: string;
  updatedAt: string;
};

type SecretDocument = {
  $id: string;
  $updatedAt?: string;
  projectId: string;
  workspaceId: string;
  userId: string;
  name: string;
  valueEncrypted: string;
};

export async function listProjectSecrets(
  databases: Databases,
  projectId: string,
): Promise<ProjectSecretPublic[]> {
  try {
    const listed = await databases.listDocuments(DATABASE_ID, AGENT_PROJECT_SECRETS_ID, [
      Query.equal("projectId", projectId),
      Query.limit(100),
    ]);
    return listed.documents.map((doc) => {
      const item = doc as unknown as SecretDocument;
      return {
        id: item.$id,
        projectId: item.projectId,
        name: item.name,
        updatedAt: item.$updatedAt || "",
      };
    });
  } catch {
    return [];
  }
}

export async function loadProjectSecretValues(
  databases: Databases,
  projectId: string,
): Promise<Record<string, string>> {
  try {
    const listed = await databases.listDocuments(DATABASE_ID, AGENT_PROJECT_SECRETS_ID, [
      Query.equal("projectId", projectId),
      Query.limit(100),
    ]);
    const out: Record<string, string> = {};
    for (const doc of listed.documents) {
      const item = doc as unknown as SecretDocument;
      if (!item.name || !item.valueEncrypted) continue;
      try {
        out[item.name] = decryptProjectSecretValue(item.valueEncrypted);
      } catch {
        // skip undecryptable rows rather than leaking ciphertext
      }
    }
    return out;
  } catch {
    return {};
  }
}

export async function upsertProjectSecret(
  databases: Databases,
  input: { projectId: string; workspaceId: string; userId: string; name: string; value: string },
): Promise<ProjectSecretPublic | null> {
  const name = input.name.trim();
  if (!isProjectSecretName(name)) return null;
  if (!isEncryptionConfigured()) {
    throw new Error("INTEGRATION_ENCRYPTION_SECRET is required to store Fairlx secrets.");
  }
  const valueEncrypted = encryptProjectSecretValue(input.value);
  const listed = await databases.listDocuments(DATABASE_ID, AGENT_PROJECT_SECRETS_ID, [
    Query.equal("projectId", input.projectId),
    Query.equal("name", name),
    Query.limit(1),
  ]);
  const existing = listed.documents[0] as unknown as SecretDocument | undefined;
  const payload = {
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    userId: input.userId,
    name,
    valueEncrypted,
  };
  const doc = existing
    ? await databases.updateDocument(DATABASE_ID, AGENT_PROJECT_SECRETS_ID, existing.$id, payload)
    : await databases.createDocument(DATABASE_ID, AGENT_PROJECT_SECRETS_ID, ID.unique(), payload);
  const saved = doc as unknown as SecretDocument;
  return { id: saved.$id, projectId: saved.projectId, name: saved.name, updatedAt: saved.$updatedAt || "" };
}

export async function getProjectSecret(
  databases: Databases,
  secretId: string,
): Promise<(ProjectSecretPublic & { workspaceId: string }) | null> {
  try {
    const doc = await databases.getDocument(DATABASE_ID, AGENT_PROJECT_SECRETS_ID, secretId);
    const item = doc as unknown as SecretDocument;
    return {
      id: item.$id,
      projectId: item.projectId,
      workspaceId: item.workspaceId,
      name: item.name,
      updatedAt: item.$updatedAt || "",
    };
  } catch {
    return null;
  }
}

export async function deleteProjectSecret(databases: Databases, secretId: string): Promise<boolean> {
  try {
    await databases.deleteDocument(DATABASE_ID, AGENT_PROJECT_SECRETS_ID, secretId);
    return true;
  } catch {
    return false;
  }
}
