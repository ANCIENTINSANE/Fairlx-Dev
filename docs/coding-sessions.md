# Fairlx coding sessions

Closed loop for a linked-repo work item: **assign Fairlx Agent → Azure sandbox clone → live Terminal/Preview → in-app diff → hunk comment → Accept → merge**. Git and shell never run on the Fairlx host.

## States

`queued` → `preparing` → `running` → `awaiting_review` → `iterating` → `merging` → `merged`

Terminal states: `failed`, `stopped`.

| Status | Meaning |
| --- | --- |
| queued | Session object exists (MCP or UI). Sandbox job not finished. |
| preparing | Creating the Azure sandbox and cloning. |
| running | Builder/tester may `exec` in the sandbox. |
| awaiting_review | PR opened or branch pushed; Changes tab shows the diff. |
| iterating | Hunk comment or `@Fairlx` mention resumed the bound run. |
| merging | Merge requested; waits for Accept unless `all_access`. |
| merged | GitHub merge succeeded. |
| failed | Clone, exec, or merge failed. |
| stopped | Operator stopped the session. |

Collection: `agent_coding_sessions` (`NEXT_PUBLIC_APPWRITE_AGENT_CODING_SESSIONS_ID`). Bound to `workItemId`, `projectId`, `runId`, `repoId`, `baseBranch`, `headBranch` (`fairlx/{workItemKey}`).

## Agent graph

Runs in the in-app chat runtime (not `packages/fairlx-multi-agent`, which has no write-guard).

| Role | Model | Tools |
| --- | --- | --- |
| Orchestrator | Grok 4.6 (Auto) or GPT-5.6 Luna (manual) | Route, `coding_session_start`, GitHub, Fairlx |
| Scout / researcher | Worker (Flash) | Read-only GitHub + work items (triage) |
| Builder | DeepSeek V4 Pro, or GPT-5.4 / Sol if Foundry env is set | Sandbox exec, GitHub writes, session start |
| Tester | Same worker family | `coding_session_exec`, `terminal` (sandbox-bound) |
| Reviewer | Luna (fallback Grok) | Read-only GitHub / inspect |

Crew panel labels Pro as the session worker. Specialists launch in parallel via `delegate_agent`.

## Human gates

Default harness permission is `staged`. Privileged tools wait for Accept:

1. **Start session** — `coding_session_start`
2. **Open PR** — `github_open_pr` (existing)
3. **Merge** — `github_merge_pr`

`all_access` auto-approves those three. Fairlx RBAC still applies. Implementation: `src/features/agent/lib/write-guard.ts`.

## Azure sandbox

Adapter: `SandboxDriver` (`create`, `exec`, `writeFile`, `readFile`, `exposePort`, `suspend`, `destroy`).

- **Primary:** Azure Container Apps Sandboxes (data plane `management.{region}.azuredevcompute.io`, API `2026-02-01-preview`, token scope `https://dynamicsessions.io/.default`).
- **Fallback:** ACA custom-container dynamic sessions (`AZURE_SESSION_POOL_ENDPOINT`). Preview ports are Sandboxes-only.
- **Tests / missing env:** `StubSandboxDriver` records commands and never executes a host shell.

Env: `AZURE_SANDBOX_TENANT_ID`, `CLIENT_ID`, `CLIENT_SECRET`, `SUBSCRIPTION_ID`, `RESOURCE_GROUP`, `GROUP_ID`, optional `REGION`, `ADC_ENDPOINT`, `DISK`.

Egress default-deny except GitHub, npm/pypi, and Azure AI endpoints. GitHub installation token is injected per clone URL and redacted in logs; it is not baked into the image.

On start: create sandbox → `git clone` with `x-access-token` → branch `fairlx/{key}` → optional `exposePort` for Preview.

Prefer **sandbox `git push`** so history is real commits. Fairlx can still `putFile` + `createPullRequest` if the sandbox cannot push.

If Azure credentials are empty, the product still persists sessions; Terminal shows stub/recorded output.

## HTTP APIs

- `GET /api/agent/coding-sessions?runId&workItemId&projectId&sessionId` — session, PR/compare diff, checks, walkthrough. Readable by the owner or any **project member**.
- `POST /api/agent/coding-sessions` — `{ workItemId, projectId?, runId?, exposePort? }`
- `POST /api/agent/coding-sessions/:sessionId/comment` — hunk comment appends a user message and resumes the bound run
- `POST /api/agent/coding-sessions/:sessionId/merge` — `all_access` merges now; `staged` queues merge-after-Accept

In-app tools: `coding_session_start` (job kind `coding_session`), `coding_session_exec`, `coding_session_status`, `github_merge_pr`, `github_request_reviewers`.

GitHub client: `compareCommits`, `listPullRequestFiles`, `createReview`, `createReviewComment`, `listCheckRuns`, `mergePullRequest`, `requestReviewers`.

## Fairlx MCP

Bring Fairlx sessions into Cursor/Claude/Codex (the inverse of “bring tools into Linear”):

| Tool | Effect |
| --- | --- |
| `fairlx_coding_session_start` | Queue/resume the session document |
| `fairlx_coding_session_status` | Sandbox, preview URL, PR |
| `fairlx_coding_session_comment` | Hunk/review comment → iterating |
| `fairlx_coding_session_merge` | Request merge (completes after Accept in Fairlx unless `all_access`) |

MCP does not clone on the Fairlx host. The Next.js agent job performs Azure clone when the in-app agent runs. Assigning Fairlx Agent or opening Agent on the work item starts that job.

## Assignee, triage, @Fairlx

- Set `FAIRLX_AGENT_USER_ID` / `FAIRLX_AGENT_MEMBER_ID` to the membership id used in `assigneeIds`. Well-known fallback: `fairlx-agent`.
- Assigning that member creates or resumes a coding session and a bound agent run.
- `FAIRLX_CODING_TRIAGE_STATUS`: when a work item enters that status, start an investigate-only run. High-confidence `coding_session_start` still Accept-gated in `staged`.
- `@Fairlx` in a work-item comment attaches to the active session run and schedules a turn.

## Billing

Token cost is metered on the bound agent run (existing wallet / usage ledger: orchestrator + builder + reviewer). Sandbox wall-clock is recorded on session events (`preparing`, `clone`, exec). Azure compute stays on the Microsoft subscription (credits); Fairlx does not run git/shell on the app host.

## Models

Keep Grok 4.6, GPT-5.6 Luna, DeepSeek V4 Pro, DeepSeek V4 Flash. Overlay extra Foundry deployments when env is set:

`AGENT_FOUNDRY_GPT54_AZURE_DEPLOYMENT`, `GPT55`, `SOL`, `CLAUDE_SONNET`, `CLAUDE_OPUS`.

Claude is optional and must not block the sprint.

## Linear vs Fairlx+

| Capability | Linear | Fairlx |
| --- | --- | --- |
| Issue → cloud sandbox → in-app diff → comment → merge | Yes | Yes (Azure ACA Sandboxes) |
| Session as a first-class object tied to a work item | Chat-adjacent | `agent_coding_sessions` |
| Agent as assignee | Linear Agent user | Fairlx Agent member id |
| Multi-agent named roles + models | Skills/loops | Orchestrator, builder, tester, reviewer in crew |
| Human gates | Product-specific | Start / open PR / merge via write-guard |
| MCP | Bring tools into Linear | `fairlx_coding_session_*` starts sessions from any agent |
| Wallet | Seat/usage | Per-run tokens + session events; Azure credits for compute |
| Work OS | Issue tracker | Projects, sprints, workflows, docs, comments |
| Host isolation | Cloud VM | No git/shell on the Fairlx box |

## Provisioning

1. `npm run db:setup:agent` (creates `agent_coding_sessions`).
2. Fill Azure sandbox env (or leave empty for stub).
3. Set `FAIRLX_AGENT_USER_ID` to a real project member id.
4. Link a GitHub repo on the project (installation or PAT).
5. Assign a work item to Fairlx Agent, or call `coding_session_start` / `fairlx_coding_session_start`.
