import type { McpConfig, McpServerConfig } from "../types";

/**
 * Default, well-known remote MCP servers Fairlx can add in one click. All are HTTP/SSE
 * endpoints, so nothing runs on the Fairlx host. Servers that need a token expose an
 * `authHeader` — the user pastes a token and we store it as a header on the server entry.
 */
export type McpCatalogItem = {
  id: string;
  name: string;
  description: string;
  url: string;
  transport: "http" | "sse";
  icon: string;
  iconClassName?: string;
  /** Header name that carries the credential; omitted for public/OAuth-in-browser servers. */
  authHeader?: string;
  authHint?: string;
  tags: string[];
};

export const DEFAULT_MCP_CATALOG: McpCatalogItem[] = [
  {
    id: "github",
    name: "GitHub",
    description: "Issues, pull requests, code search and Actions across your repos.",
    url: "https://api.githubcopilot.com/mcp/",
    transport: "http",
    icon: "fa-brands fa-github",
    iconClassName: "text-foreground",
    authHeader: "Authorization",
    authHint: "Bearer <GitHub PAT with repo scope>",
    tags: ["code", "popular"],
  },
  {
    id: "context7",
    name: "Context7",
    description: "Up-to-date library docs so the agent stops guessing APIs.",
    url: "https://mcp.context7.com/mcp",
    transport: "http",
    icon: "fa-solid fa-book",
    iconClassName: "text-violet-500",
    tags: ["docs", "popular"],
  },
  {
    id: "sentry",
    name: "Sentry",
    description: "Pull stack traces and issues straight into debug sessions.",
    url: "https://mcp.sentry.dev/mcp",
    transport: "http",
    icon: "fa-solid fa-bug",
    iconClassName: "text-rose-500",
    tags: ["debug"],
  },
  {
    id: "linear",
    name: "Linear",
    description: "Read and update Linear issues, cycles and projects.",
    url: "https://mcp.linear.app/sse",
    transport: "sse",
    icon: "fa-solid fa-chart-gantt",
    iconClassName: "text-foreground",
    tags: ["work"],
  },
  {
    id: "notion",
    name: "Notion",
    description: "Search and edit Notion pages and databases.",
    url: "https://mcp.notion.com/mcp",
    transport: "http",
    icon: "fa-solid fa-n",
    iconClassName: "text-foreground",
    tags: ["docs"],
  },
  {
    id: "vercel",
    name: "Vercel",
    description: "Deployments, logs and project settings.",
    url: "https://mcp.vercel.com",
    transport: "http",
    icon: "fa-solid fa-caret-up",
    iconClassName: "text-foreground",
    tags: ["deploy"],
  },
  {
    id: "cloudflare-docs",
    name: "Cloudflare Docs",
    description: "Workers, Pages, D1, R2 and KV documentation.",
    url: "https://docs.mcp.cloudflare.com/sse",
    transport: "sse",
    icon: "fa-brands fa-cloudflare",
    iconClassName: "text-orange-500",
    tags: ["docs"],
  },
  {
    id: "supabase",
    name: "Supabase",
    description: "Manage Postgres tables, auth and edge functions.",
    url: "https://mcp.supabase.com/mcp",
    transport: "http",
    icon: "fa-solid fa-database",
    iconClassName: "text-emerald-500",
    tags: ["data"],
  },
  {
    id: "stripe",
    name: "Stripe",
    description: "Customers, payments and subscriptions via the Stripe API.",
    url: "https://mcp.stripe.com",
    transport: "http",
    icon: "fa-brands fa-stripe-s",
    iconClassName: "text-indigo-500",
    authHeader: "Authorization",
    authHint: "Bearer sk_live_… or sk_test_…",
    tags: ["billing"],
  },
];

export function catalogServerConfig(item: McpCatalogItem, token?: string): McpServerConfig {
  const server: McpServerConfig = { url: item.url, transport: item.transport };
  if (item.authHeader && token?.trim()) {
    const value = token.trim();
    server.headers = {
      [item.authHeader]: item.authHeader === "Authorization" && !/^bearer /i.test(value) ? `Bearer ${value}` : value,
    };
  }
  return server;
}

/** Catalog entries not yet present in the user's config (matched by URL or name). */
export function missingCatalogItems(config: McpConfig | undefined): McpCatalogItem[] {
  const servers = Object.entries(config?.mcpServers ?? {});
  return DEFAULT_MCP_CATALOG.filter(
    (item) =>
      !servers.some(
        ([name, server]) =>
          name.toLowerCase() === item.id || name.toLowerCase() === item.name.toLowerCase() || server.url === item.url,
      ),
  );
}

export function withCatalogServer(config: McpConfig | undefined, item: McpCatalogItem, token?: string): McpConfig {
  return {
    ...(config ?? {}),
    mcpServers: {
      ...(config?.mcpServers ?? {}),
      [item.id]: catalogServerConfig(item, token),
    },
  };
}
