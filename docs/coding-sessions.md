# Fairlx coding sessions

Closed loop for a linked-repo work item: **assign Fairlx Agent → Azure sandbox clone → auto install/start → live Preview iframe → Claude Code or Codex in `/workspace` → in-app diff → hunk comment → PR from `fairlx/{key}` → merge**. Git and shell never run on the Fairlx host.

## States

`queued` → `preparing` → `running` → `awaiting_review` → `iterating` → `merging` → `merged`

Terminal states: `failed`, `stopped`.

| Status | Meaning |
| --- | --- |
| queued | Session object exists (MCP or UI). Sandbox job not finished. |
| preparing | Creating the Azure sandbox, cloning, installing, starting the app. |
| running | Preview health-check passed (or sandbox is bound). Builder uses `coding_session_implement` / `exec`. |
| awaiting_review | PR opened or branch pushed; Changes tab shows the diff. |
| iterating | Hunk comment or `@Fairlx` mention resumed the bound run. |
| merging | Merge requested; waits for Accept unless auto / `all_access`. |
| merged | GitHub merge succeeded. |
| failed | Clone, exec, or merge failed. |
| stopped | Operator stopped the session. |

Collection: `agent_coding_sessions` (`NEXT_PUBLIC_APPWRITE_AGENT_CODING_SESSIONS_ID`). Bound to `workItemId`, `projectId`, `runId`, `repoId`, `baseBranch`, `headBranch` (`fairlx/{workItemKey}`). Preview state lives in `metaJson` plus a `session_meta` event (`driver`, `previewLive`, `codingAgent`, artifacts).

## Agent graph

Runs in the in-app chat runtime (not `packages/fairlx-multi-agent`, which has no write-guard).

| Role | Model | Tools |
| --- | --- | --- |
| Orchestrator | Grok 4.6 (Auto) or GPT-5.6 Luna (manual) | Plan, gates, `coding_session_start`, `coding_session_implement` |
| Scout / researcher | Worker (Flash) | Read-only GitHub + work items (triage) |
| Builder | Claude Code or Codex **inside the sandbox** when credentials exist; otherwise Fairlx specialists via `coding_session_exec` (never Contents API dumps while bound) | Sandbox implement / exec |
| Tester | Same worker family | `coding_session_exec`, `coding_session_browser` |
| Reviewer | Luna (fallback Grok) | In-app diff comments, read-only GitHub |

Crew panel still labels specialists. Implementation happens in Azure `/workspace`.

## Human gates

Default harness permission is `staged`. Privileged tools wait for Accept:

1. **Accept implementation plan** — `submit_implementation_plan`
2. **Start session** — `coding_session_start`
3. **Open PR** — `github_open_pr`
4. **Merge** — `github_merge_pr`

**Autonomous coding** is explicit:

- Harness toggle **Autonomous coding** (independent of Staged vs All access)
- `@Fairlx-auto` on a linked work item
- `all_access` (skips all non-destructive confirms)

Auto skips extra Accepts on the coding-loop tools only. Mail, invites, and docs still wait in staged. Fairlx RBAC still applies. Implementation: `src/features/agent/lib/write-guard.ts`, `auto-mode.ts`.

## Azure sandbox

Adapter: `SandboxDriver` (`create`, `exec`, `writeFile`, `readFile`, `exposePort`, `suspend`, `destroy`).

- **Primary:** Azure Container Apps Sandboxes (data plane `management.{region}.azuredevcompute.io`, API `2026-02-01-preview`, token scope `https://dynamicsessions.io/.default`).
- **Fallback:** ACA custom-container dynamic sessions (`AZURE_SESSION_POOL_ENDPOINT`). Preview ports are Sandboxes-only.
- **Tests / missing env:** `StubSandboxDriver` records commands and never executes a host shell. Stub URLs (`preview.stub.fairlx.local`) are **never** treated as live.

Env: `AZURE_SANDBOX_TENANT_ID`, `CLIENT_ID`, `CLIENT_SECRET`, `SUBSCRIPTION_ID`, `RESOURCE_GROUP`, `GROUP_ID`, optional `REGION`, `ADC_ENDPOINT`, `DISK`.

On start: create sandbox with project secrets + coding-agent env → `git clone` with `x-access-token` → branch `fairlx/{key}` → detect package manager / start command → install → background start → health-check → **then** `exposePort` → optional screenshot.

`previewLive` is true only when the health-check succeeds on the Azure driver. The Preview tab iframes that URL only then, with a copy-link for the shareable Azure port URL.

While a sandbox is bound: `github_write_file` and `github_open_pr files[]` are refused. PR = sandbox `git push` of `fairlx/{key}`, then `github_open_pr` with empty `files[]`.

If Azure credentials are empty, the product still persists sessions; Terminal shows stub/recorded output; Preview stays “not live”.

## Claude Code / Codex in the sandbox

Fairlx plans and gates in the product. The coding agent runs **inside** the sandbox against `/workspace`:

| Preference | Env |
| --- | --- |
| Claude Code | `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` or Foundry Claude keys |
| Codex | `OPENAI_API_KEY` / `CODEX_API_KEY` or Foundry GPT keys |
| Override | `FAIRLX_SANDBOX_CODING_AGENT=auto\|claude\|codex\|specialists` |

Without those credentials the CLI **will not run**. `coding_session_implement` returns a clear error and Fairlx specialists may `coding_session_exec` in `/workspace`. They must not dump files through the GitHub Contents API while the sandbox is bound.

## Preview, browser, artifacts

After the app is healthy, `coding_session_browser` opens `http://127.0.0.1:{port}` with headless Chromium / Playwright in the sandbox and stores a screenshot on the session. Recordings skip unless a future ffmpeg path exists. Preview and Changes tabs render `/api/agent/coding-sessions/:id/artifacts/:artifactId`. The in-app iframe **is** the sandbox app browser when Azure preview is live.

## Native diffs and reviews

Changes tab: unified diff, checks, walkthrough, click a hunk line, comment resumes the bound run. Merge from Fairlx after Accept (unless auto).

## Environments and Fairlx secrets

Project Settings → **Coding**: runtime, prepare script, start command, exposePort, env var names.

**Fairlx secrets** (GitHub Actions-style names): encrypted at rest with `INTEGRATION_ENCRYPTION_SECRET` (AES-256-GCM). Values are injected into `sandbox.create({ env })`. List APIs return names only. Session events redact values. Run `npm run db:setup:agent` for `agent_project_secrets` and `agent_coding_environments`.

## HTTP APIs

- `GET /api/agent/coding-sessions?runId&workItemId&projectId&sessionId` — session, PR/compare diff, checks, walkthrough. Readable by the owner or any **project member**.
- `POST /api/agent/coding-sessions` — `{ workItemId, projectId?, runId?, exposePort? }`
- `POST /api/agent/coding-sessions/:sessionId/comment` — hunk comment appends a user message and resumes the bound run
- `POST /api/agent/coding-sessions/:sessionId/merge` — auto / `all_access` merges now; `staged` queues merge-after-Accept
- `GET /api/agent/coding-sessions/:sessionId/artifacts/:artifactId` — screenshot bytes from the sandbox
- `GET/POST /api/agent/coding-environment?projectId=`
- `GET/POST /api/agent/secrets` · `DELETE /api/agent/secrets/:secretId`

In-app tools: `coding_session_start` (job kind `coding_session`), `coding_session_exec`, `coding_session_status`, `coding_session_implement`, `coding_session_browser`, `github_merge_pr`, `github_request_reviewers`.

## Fairlx MCP (outbound)

Bring Fairlx sessions into Cursor/Claude/Codex:

| Tool | Effect |
| --- | --- |
| `fairlx_coding_session_start` | Queue/resume the session document |
| `fairlx_coding_session_status` | Sandbox, preview URL, PR, `previewLive` |
| `fairlx_coding_session_comment` | Hunk/review comment → iterating |
| `fairlx_coding_session_merge` | Request merge |

MCP does not clone on the Fairlx host. The Next.js agent job performs Azure clone when the in-app agent runs.

## Bring tools into Fairlx (inbound MCP)

Agent → **Manage MCP**: add an HTTP MCP server (Sentry, Datadog, …). `mcp_list` lists that server’s tools. `mcp_call` invokes them. Fairlx native tools stay `fairlx_*`.

## Assignee, triage, @Fairlx

- Set `FAIRLX_AGENT_USER_ID` / `FAIRLX_AGENT_MEMBER_ID` to the membership id used in `assigneeIds`. Well-known fallback: `fairlx-agent`.
- Assigning that member creates or resumes a coding session and a bound agent run.
- `FAIRLX_CODING_TRIAGE_STATUS`: when a work item enters that status, start investigate. Implement in auto only if Autonomous coding / `all_access` / `@Fairlx-auto`. RBAC is unchanged.
- `@Fairlx` in a work-item comment, Slack Events, Discord interactions, Teams webhook, or WhatsApp Cloud API webhook attaches to the active session or starts one. `@Fairlx-auto` sets autonomous mode for that event. Include a work-item key such as `WEB-12`.

Slack Events API is the fully wired inbound path. Discord, Teams, and WhatsApp share `handleInboundFairlxMention`.

## Billing

Token cost is metered on the bound agent run. Sandbox wall-clock is recorded on session events. Azure compute stays on the Microsoft subscription.

## Models

Keep Grok 4.6, GPT-5.6 Luna, DeepSeek V4 Pro, DeepSeek V4 Flash. Overlay extra Foundry deployments when env is set. Claude/Codex **sandbox CLIs** are separate from Fairlx chat models.

## Linear vs Fairlx+

| Capability | Linear | Fairlx |
| --- | --- | --- |
| Issue → cloud sandbox → running preview → in-app diff → comment → merge | Yes | Yes (Azure ACA Sandboxes + health-checked iframe) |
| Auto install + start | Yes | Yes (lockfile / package.json / Python / Go, or project Coding settings) |
| Coding agent in sandbox | Claude Code / Codex | Claude Code / Codex when credentials exist; specialists fallback is explicit |
| Browser QA | Screenshots / recordings | Sandbox Chromium screenshot; recording skipped unless ffmpeg exists |
| Environments + secrets | Workspace settings | Project Settings → Coding + Fairlx secrets |
| `@agent` in Slack/Teams | Yes | `@Fairlx` / `@Fairlx-auto` Slack, Discord, Teams, WhatsApp |
| MCP into the product | Sentry/Datadog into Linear | HTTP MCP via Manage MCP + `mcp_list` / `mcp_call` |
| Host isolation | Cloud VM | No git/shell on the Fairlx box |

## Provisioning

1. `npm run db:setup:agent` (coding sessions, secrets, coding environments).
2. Fill Azure sandbox env (or leave empty for stub — Preview will not iframe).
3. Set `INTEGRATION_ENCRYPTION_SECRET` for Fairlx secrets.
4. Optional: Anthropic/OpenAI keys so Claude Code or Codex can actually run in the box.
5. Set `FAIRLX_AGENT_USER_ID` to a real project member id.
6. Link a GitHub repo on the project.
7. Assign a work item to Fairlx Agent, or call `coding_session_start`.
8. Slack Events URL: `{NEXT_PUBLIC_APP_URL}/api/integrations/slack/events`.
