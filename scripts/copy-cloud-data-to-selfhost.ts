/**
 * Copy Cloud *data* (documents + files) onto the self-host project.
 * Schema/users are assumed to already exist from the earlier migration.
 *
 * Source: commented Cloud keys in .env.local (or CLOUD_APPWRITE_*).
 * Dest: current NEXT_PUBLIC_APPWRITE_* (self-host).
 *
 *   npx tsx scripts/copy-cloud-data-to-selfhost.ts
 */
import * as dotenv from "dotenv";
import * as fs from "fs";
import { Client, Databases, Storage, Query } from "node-appwrite";
import { InputFile } from "node-appwrite/file";

dotenv.config({ path: ".env.local" });

const CLOUD_PROD_PROJECT = "69b1b0640035b8ff70ef";

function parseCommentedCloud(): { endpoint: string; project: string; key: string } {
  const fromEnv = {
    endpoint: process.env.CLOUD_APPWRITE_ENDPOINT,
    project: process.env.CLOUD_APPWRITE_PROJECT,
    key: process.env.CLOUD_APPWRITE_KEY,
  };
  if (fromEnv.endpoint && fromEnv.project && fromEnv.key) {
    return fromEnv as { endpoint: string; project: string; key: string };
  }

  const text = fs.readFileSync(".env.local", "utf8");
  const block = text.split("# Cloud prod (rollback)")[1] || text;
  const projectMatch = block.match(
    /^#\s*NEXT_PUBLIC_APPWRITE_PROJECT=(69b1b0640035b8ff70ef)\s*$/m,
  );
  const keyMatch = block.match(/^#\s*NEXT_APPWRITE_KEY=(standard_[a-z0-9]+)\s*$/m);
  const endpointMatch = text.match(
    /^#\s*NEXT_PUBLIC_APPWRITE_ENDPOINT=(https:\/\/sgp\.cloud\.appwrite\.io\/v1)\s*$/m,
  );
  const project = projectMatch?.[1] || CLOUD_PROD_PROJECT;
  const key = keyMatch?.[1] || "";
  const endpoint = endpointMatch?.[1] || "https://sgp.cloud.appwrite.io/v1";
  if (!key) {
    throw new Error("Could not find Cloud prod API key in .env.local");
  }
  return { endpoint, project, key };
}

function client(endpoint: string, project: string, key: string) {
  return new Client().setEndpoint(endpoint).setProject(project).setKey(key);
}

type DestAttr = {
  key: string;
  type: string;
  required: boolean;
  array?: boolean;
  default?: unknown;
  elements?: string[];
  size?: number;
};

const FIELD_ALIASES: Record<string, Record<string, string>> = {
  billing_accounts: { status: "billingStatus" },
  billing_audit_logs: { description: "metadata" },
};

function stripMeta(doc: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc)) {
    if (k.startsWith("$")) continue;
    out[k] = v;
  }
  return out;
}

function fallbackValue(
  attr: DestAttr,
  data: Record<string, unknown>,
  collectionId: string,
): unknown {
  if (collectionId === "project_members" && attr.key === "roleId") {
    return String(data.role || data.roleName || "member");
  }
  if (attr.default !== undefined && attr.default !== null) return attr.default;
  if (attr.array) return [];
  switch (attr.type) {
    case "integer":
    case "double":
      return 0;
    case "boolean":
      return false;
    case "datetime":
      return new Date().toISOString();
    case "enum":
      return attr.elements?.[0] ?? "";
    default:
      return "";
  }
}

function coerceValue(value: unknown, attr: DestAttr): unknown {
  if (value === null || value === undefined) return value;
  if (attr.array) return Array.isArray(value) ? value : [value];
  if (attr.elements?.length && typeof value === "string") {
    if (attr.elements.includes(value)) return value;
    const upper = value.toUpperCase();
    if (attr.elements.includes(upper)) return upper;
    const aliases: Record<string, string> = {
      CREDIT: "REWARD_CREDIT",
      DEBIT: "USAGE",
      credit: "REWARD_CREDIT",
      debit: "USAGE",
    };
    const mapped = aliases[value] || aliases[upper];
    if (mapped && attr.elements.includes(mapped)) return mapped;
    return attr.elements[0];
  }
  if (attr.type === "integer" && typeof value === "string") {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : 0;
  }
  if (attr.type === "double" && typeof value === "string") {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  }
  if (attr.type === "boolean") return Boolean(value);
  if (typeof value === "string" && attr.size && value.length > attr.size) {
    return value.slice(0, attr.size);
  }
  return value;
}

function adaptDocument(
  data: Record<string, unknown>,
  attrs: DestAttr[],
  collectionId: string,
): Record<string, unknown> {
  const aliases = FIELD_ALIASES[collectionId] || {};
  const sourced = { ...data };
  for (const [from, to] of Object.entries(aliases)) {
    if (sourced[to] == null && sourced[from] != null) sourced[to] = sourced[from];
  }

  const byKey = new Map(attrs.map((attr) => [attr.key, attr]));
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(sourced)) {
    const attr = byKey.get(key);
    if (!attr) continue;
    if (value === null || value === undefined) continue;
    out[key] = coerceValue(value, attr);
  }

  for (const attr of attrs) {
    const current = out[attr.key];
    const missing =
      current === undefined ||
      current === null ||
      (attr.required && current === "" && attr.type === "string");
    if (!attr.required && missing) continue;
    if (!missing) continue;
    out[attr.key] = fallbackValue(attr, sourced, collectionId);
  }
  return out;
}

async function listDestAttributes(
  dst: Databases,
  databaseId: string,
  collectionId: string,
): Promise<DestAttr[] | null> {
  try {
    const all: DestAttr[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await withRetry(() =>
        dst.listAttributes(
          databaseId,
          collectionId,
          cursor ? [Query.limit(100), Query.cursorAfter(cursor)] : [Query.limit(100)],
        ),
      );
      for (const raw of page.attributes as Array<Record<string, unknown>>) {
        const status = String(raw.status || "available");
        if (status && status !== "available") continue;
        all.push({
          key: String(raw.key),
          type:
            Array.isArray(raw.elements) && (raw.elements as unknown[]).length
              ? "enum"
              : String(raw.type),
          required: Boolean(raw.required),
          array: Boolean(raw.array),
          default: raw.default,
          elements: Array.isArray(raw.elements) ? (raw.elements as string[]) : undefined,
          size: typeof raw.size === "number" ? raw.size : undefined,
        });
      }
      if (page.attributes.length < 100) break;
      cursor = String((page.attributes[page.attributes.length - 1] as { key: string }).key);
    }
    return all;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  ${collectionId}: dest collection missing or unread (${msg})`);
    return null;
  }
}

function appwriteCode(err: unknown): number | undefined {
  return (err as { code?: number }).code;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 8): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const code = appwriteCode(err);
      const msg = err instanceof Error ? err.message : String(err);
      const retryable =
        code === 429 ||
        code === 500 ||
        code === 502 ||
        code === 503 ||
        msg.toLowerCase().includes("fetch failed") ||
        msg.toLowerCase().includes("timeout") ||
        msg.toLowerCase().includes("network") ||
        msg.toLowerCase().includes("econnreset") ||
        msg.toLowerCase().includes("socket");
      if (!retryable || i === attempts - 1) throw err;
      await sleep(1000 * 2 ** i);
    }
  }
  throw last;
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

async function listAllCollections(src: Databases, databaseId: string) {
  const all = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await withRetry(() =>
      src.listCollections(
        databaseId,
        cursor ? [Query.limit(100), Query.cursorAfter(cursor)] : [Query.limit(100)],
      ),
    );
    all.push(...page.collections);
    if (page.collections.length < 100) break;
    cursor = page.collections[page.collections.length - 1].$id;
  }
  return all;
}

async function copyDocuments(src: Databases, dst: Databases, databaseId: string) {
  const collections = await listAllCollections(src, databaseId);
  const only = (process.env.ONLY_COLLECTIONS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const onlyFrom = process.env.ONLY_FROM || "";
  const startAt = onlyFrom ? collections.findIndex((col) => col.$id === onlyFrom) : 0;
  const selected = collections.filter((col) => {
    if (only.length && !only.includes(col.$id)) return false;
    if (onlyFrom && startAt >= 0) {
      return collections.findIndex((item) => item.$id === col.$id) >= startAt;
    }
    return true;
  });
  console.log(
    `Collections: ${selected.length}/${collections.length}${only.length ? ` [${only.join(",")}]` : ""}${onlyFrom ? ` (from ${onlyFrom})` : ""}`,
  );

  for (const col of selected) {
    try {
      const attrs = await listDestAttributes(dst, databaseId, col.$id);
      if (!attrs) continue;

      let copied = 0;
      let skipped = 0;
      let failed = 0;
      let cursor: string | undefined;
      let total = 0;
      for (;;) {
        const page = await withRetry(() =>
          src.listDocuments(
            databaseId,
            col.$id,
            cursor
              ? [Query.limit(100), Query.cursorAfter(cursor)]
              : [Query.limit(100)],
          ),
        );
        total = page.total;
        if (!page.documents.length) break;
        await mapPool(page.documents, 8, async (doc) => {
          const data = adaptDocument(
            stripMeta(doc as unknown as Record<string, unknown>),
            attrs,
            col.$id,
          );
          try {
            await withRetry(() =>
              dst.createDocument(databaseId, col.$id, doc.$id, data, doc.$permissions),
            );
            copied++;
          } catch (err) {
            if (appwriteCode(err) === 409) {
              skipped++;
              return;
            }
            failed++;
            if (failed <= 5) {
              const msg = err instanceof Error ? err.message : String(err);
              console.warn(`\n  ${col.$id}/${doc.$id}: ${msg}`);
            }
          }
        });
        process.stdout.write(
          `\r  ${col.$id}: copied=${copied} skipped=${skipped} failed=${failed} / ${total}   `,
        );
        if (page.documents.length < 100) break;
        cursor = page.documents[page.documents.length - 1].$id;
      }
      console.log(
        `\r  ${col.$id}: copied=${copied} skipped=${skipped} failed=${failed} / ${total}                    `,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ${col.$id}: collection aborted (${msg})`);
    }
  }
}

async function copyFiles(
  src: Storage,
  dst: Storage,
  cloud: { endpoint: string; project: string; key: string },
) {
  const buckets = await src.listBuckets([Query.limit(100)]);
  console.log(`Buckets: ${buckets.buckets.length}`);

  for (const bucket of buckets.buckets) {
    try {
      await dst.getBucket(bucket.$id);
    } catch {
      console.warn(`  dest missing bucket ${bucket.$id} — skip files`);
      continue;
    }

    let copied = 0;
    let skipped = 0;
    let failed = 0;
    let cursor: string | undefined;
    for (;;) {
      const page = await withRetry(() =>
        src.listFiles(
          bucket.$id,
          cursor
            ? [Query.limit(100), Query.cursorAfter(cursor)]
            : [Query.limit(100)],
        ),
      );
      if (!page.files.length) break;
      for (const file of page.files) {
        try {
          const downloadUrl = `${cloud.endpoint}/storage/buckets/${bucket.$id}/files/${file.$id}/download`;
          const response = await withRetry(async () => {
            const res = await fetch(downloadUrl, {
              headers: {
                "x-appwrite-project": cloud.project,
                "x-appwrite-key": cloud.key,
              },
            });
            if (!res.ok) {
              throw new Error(`download ${res.status} ${await res.text()}`);
            }
            return res;
          });
          const buffer = Buffer.from(await response.arrayBuffer());
          const input = InputFile.fromBuffer(buffer, file.name);
          await dst.createFile(bucket.$id, file.$id, input, file.$permissions);
          copied++;
        } catch (err) {
          const code = (err as { code?: number }).code;
          if (code === 409) {
            skipped++;
          } else {
            failed++;
            if (failed <= 8) {
              const msg = err instanceof Error ? err.message : String(err);
              console.warn(`  ${bucket.$id}/${file.$id} (${file.name}, ${file.sizeOriginal}b): ${msg}`);
            }
          }
        }
      }
      process.stdout.write(
        `\r  ${bucket.$id}: copied=${copied} skipped=${skipped} failed=${failed} / ${page.total}   `,
      );
      if (page.files.length < 100) break;
      cursor = page.files[page.files.length - 1].$id;
    }
    console.log(
      `\r  ${bucket.$id}: copied=${copied} skipped=${skipped} failed=${failed}                    `,
    );
  }
}

async function main() {
  const cloud = parseCommentedCloud();
  const destEndpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!;
  const destProject = process.env.NEXT_PUBLIC_APPWRITE_PROJECT!;
  const destKey = process.env.NEXT_APPWRITE_KEY!;
  const databaseId = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID || "fairlx";

  if (destEndpoint.includes("cloud.appwrite.io")) {
    throw new Error("Dest endpoint still points at Cloud. Aborting.");
  }

  console.log(`Cloud  ${cloud.endpoint} / ${cloud.project}`);
  console.log(`Self   ${destEndpoint} / ${destProject}`);
  console.log(`DB     ${databaseId}`);

  const srcDb = new Databases(client(cloud.endpoint, cloud.project, cloud.key));
  const dstDb = new Databases(client(destEndpoint, destProject, destKey));
  const srcSt = new Storage(client(cloud.endpoint, cloud.project, cloud.key));
  const dstSt = new Storage(client(destEndpoint, destProject, destKey));

  const skipDocs = process.env.SKIP_DOCUMENTS === "1";
  if (!skipDocs) {
    console.log("\n=== Documents ===");
    try {
      await copyDocuments(srcDb, dstDb, databaseId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Documents blocked: ${msg}`);
      if (msg.includes("402") || msg.toLowerCase().includes("billing")) {
        console.error(
          "Cloud database reads are exhausted. Re-run after quota resets or after a plan upgrade:",
        );
        console.error("  npx tsx scripts/copy-cloud-data-to-selfhost.ts");
      }
    }
  } else {
    console.log("\n=== Documents === skipped (SKIP_DOCUMENTS=1)");
  }

  console.log("\n=== Files ===");
  await copyFiles(srcSt, dstSt, cloud);

  console.log("\nDone.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
