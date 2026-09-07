# Changelog

This file is generated on every `git commit` and `git push`. Do not edit it by hand.

Older session notes live in [docs/changelog-history.md](docs/changelog-history.md).

## Unreleased

Files in this commit:

- `.env.example`
- `.gitignore`
- `docs/coding-sessions.md`
- `packages/fairlx-mcp/src/catalog.test.ts`
- `packages/fairlx-mcp/src/runtime/types.ts`
- `packages/fairlx-mcp/src/tools/billing.test.ts`
- `packages/fairlx-mcp/src/tools/billing.ts`
- `packages/fairlx-mcp/src/tools/catalog.ts`
- `packages/fairlx-mcp/src/tools/coding-session.test.ts`
- `packages/fairlx-mcp/src/tools/coding-session.ts`
- `packages/fairlx-mcp/src/tools/index.ts`
- `packages/fairlx-mcp/src/tools/write.ts`
- `packages/fairlx-multi-agent/src/config.ts`
- `scripts/copy-cloud-data-to-selfhost.ts`
- `scripts/database-initialization/collections/agent-coding-sessions.ts`
- `scripts/database-initialization/collections/github-accounts.ts`
- `scripts/database-initialization/setup-agent-collections.ts`
- `scripts/database-initialization/setup-database.ts`
- `scripts/database-initialization/setup-runner.ts`
- `scripts/wipe-github-connections.ts`
- `src/app/(dashboard)/workspaces/[workspaceId]/projects/[projectId]/github/client.tsx`
- `src/app/(standalone)/workspaces/[workspaceId]/projects/[projectId]/settings/client.tsx`
- `src/config.ts`
- `src/features/agent/api/use-coding-session.ts`
- `src/features/agent/components/agent-chat-thread.tsx`
- `src/features/agent/components/agent-crew-panel.tsx`
- `src/features/agent/components/agent-ops-screens.tsx`
- `src/features/agent/components/agent-screens.tsx`
- `src/features/agent/components/coding-session-panel.tsx`
- `src/features/agent/components/diff-viewer.tsx`
- `src/features/agent/components/manage-models-dialog.tsx`
- `src/features/agent/components/plugin-connect-card.tsx`
- `src/features/agent/components/workflow-view.tsx`
- `src/features/agent/constants.ts`
- `src/features/agent/lib/agent-core.test.ts`
- `src/features/agent/lib/ai-usage-billing.ts`
- `src/features/agent/lib/brain/brain.test.ts`
- `src/features/agent/lib/brain/definitions.ts`
- `src/features/agent/lib/brain/select.ts`
- `src/features/agent/lib/client-defaults.ts`
- `src/features/agent/lib/coding-session-hooks.ts`
- `src/features/agent/lib/coding-session-start.ts`
- `src/features/agent/lib/coding-sessions.test.ts`
- `src/features/agent/lib/coding-sessions.ts`
- `src/features/agent/lib/context.ts`
- `src/features/agent/lib/github-scope.test.ts`
- `src/features/agent/lib/github-scope.ts`
- `src/features/agent/lib/graph.ts`
- `src/features/agent/lib/job-runner.ts`
- `src/features/agent/lib/model-context.test.ts`
- `src/features/agent/lib/model-context.ts`
- `src/features/agent/lib/platform-credentials.test.ts`
- `src/features/agent/lib/platform-credentials.ts`
- `src/features/agent/lib/prompt-budget.ts`
- `src/features/agent/lib/prompt.ts`
- `src/features/agent/lib/run-usage.test.ts`
- `src/features/agent/lib/run-usage.ts`
- `src/features/agent/lib/runs.ts`
- `src/features/agent/lib/runtime.ts`
- `src/features/agent/lib/sandbox/azure.ts`
- `src/features/agent/lib/sandbox/index.ts`
- `src/features/agent/lib/sandbox/stub.ts`
- `src/features/agent/lib/sandbox/types.ts`
- `src/features/agent/lib/subagent-tree.test.ts`
- `src/features/agent/lib/subagent-tree.ts`
- `src/features/agent/lib/tool-schemas.ts`
- `src/features/agent/lib/tools-scope.test.ts`
- `src/features/agent/lib/tools.ts`
- `src/features/agent/lib/transcribe.test.ts`
- `src/features/agent/lib/turn-errors.test.ts`
- `src/features/agent/lib/turn-errors.ts`
- `src/features/agent/lib/write-guard.test.ts`
- `src/features/agent/lib/write-guard.ts`
- `src/features/agent/plugins/catalog.test.ts`
- `src/features/agent/plugins/catalog.ts`
- `src/features/agent/plugins/github-helpers.ts`
- `src/features/agent/plugins/github.ts`
- `src/features/agent/plugins/index.ts`
- `src/features/agent/server/route.ts`
- `src/features/agent/types.ts`
- `src/features/auth/components/linked-providers.tsx`
- `src/features/auth/components/sign-in-card.tsx`
- `src/features/auth/components/sign-up-card.tsx`
- `src/features/comments/server/route.ts`
- `src/features/github-integration/__tests__/github-accounts.test.ts`
- `src/features/github-integration/__tests__/github-contents-path.test.ts`
- `src/features/github-integration/__tests__/github-permissions.test.ts`
- `src/features/github-integration/__tests__/github-pr-review.test.ts`
- `src/features/github-integration/api/use-github.ts`
- `src/features/github-integration/components/connect-repository.tsx`
- `src/features/github-integration/components/github-optional-prompt.tsx`
- `src/features/github-integration/components/token-guide.tsx`
- `src/features/github-integration/hooks/use-can-manage-github.ts`
- `src/features/github-integration/lib/github-accounts.ts`
- `src/features/github-integration/lib/github-api.ts`
- `src/features/github-integration/lib/github-link.ts`
- `src/features/github-integration/lib/github-permissions.ts`
- `src/features/github-integration/schemas.ts`
- `src/features/github-integration/server/account-route.ts`
- `src/features/github-integration/server/documentation-route.ts`
- `src/features/github-integration/server/index.ts`
- `src/features/github-integration/server/oauth-route.ts`
- `src/features/github-integration/server/route.ts`
- `src/features/github-integration/server/webhook-route.ts`
- `src/features/github-integration/types.ts`
- `src/features/mcp/bind-runtime.ts`
- `src/features/sprints/server/work-items-route.ts`
- `src/lib/ai-model-pricing.ts`
- `src/lib/oauth-redirect.test.ts`
- `src/lib/oauth-redirect.ts`
- `src/lib/oauth.ts`

## Recent commits

| Date | Commit | Message | Author |
|------|--------|---------|--------|
| 2026-09-06 | `b5cda5c` | chore: bump version to 0.2.107 [skip ci] | github-actions[bot] |
| 2026-09-06 | `c0f8f8a` | Merge pull request #309 from Happyesss/main | Shashank Kumar Rathour |
| 2026-09-06 | `cf1647a` | chore: bump version to 0.2.106 [skip ci] | github-actions[bot] |
| 2026-09-06 | `b276c5e` | refactor: use hard page redirects for auth flows and improve workspace navigation consistency across the app | Happyesss |
| 2026-09-06 | `210d465` | chore: bump version to 0.2.106 [skip ci] | github-actions[bot] |
| 2026-09-06 | `9756ebb` | Merge pull request #308 from Happyesss/main | Shashank Kumar Rathour |
| 2026-09-06 | `dc87db5` | chore: bump version to 0.2.105 [skip ci] | github-actions[bot] |
| 2026-09-06 | `3a0d23c` | feat: implement dismissible Linear-inspired suggestion cards in AgentCommandInput and reorder AgentHome layout | Happyesss |
| 2026-09-06 | `412c5b9` | chore: bump version to 0.2.104 [skip ci] | github-actions[bot] |
| 2026-09-06 | `03593e4` | Merge pull request #307 from ANCIENTINSANE/main | Surendra Codes |
| 2026-09-06 | `fe9d2a6` | fix: resolve sprints by name and fold duplicate sprint numbers | ANCIENTINSANE |
| 2026-09-06 | `cd02184` | fix: keep agent board writes safe, visible, and in the right sprint | ANCIENTINSANE |
| 2026-09-05 | `8cad584` | chore: bump version to 0.2.103 [skip ci] | github-actions[bot] |
| 2026-09-06 | `ca6c854` | Merge pull request #306 from ANCIENTINSANE/main | Surendra Codes |
| 2026-09-06 | `8c49ee0` | Merge stemlen/main into fork main to sync upstream before contribution. | ANCIENTINSANE |
| 2026-09-06 | `c719487` | feat: researched project docs, agent context fitting, and usage billing | ANCIENTINSANE |
| 2026-09-05 | `8b787ea` | chore: bump version to 0.2.102 [skip ci] | github-actions[bot] |
| 2026-09-05 | `66e7390` | Merge pull request #305 from Happyesss/main | Shashank Kumar Rathour |
| 2026-09-05 | `f06ca01` | chore: bump version to 0.2.101 [skip ci] | github-actions[bot] |
| 2026-09-05 | `c81e03c` | Merge pull request #304 from Happyesss/contrib/context-meter | Shashank Kumar Rathour |
| 2026-09-05 | `3de0bd4` | chore: bump version to 0.2.101 [skip ci] | github-actions[bot] |
| 2026-09-05 | `7bc902a` | Merge stemlen/main into fork and resolve prompt rule conflict. | Happyesss |
| 2026-09-05 | `d09e948` | chore: bump version to 0.2.100 [skip ci] | github-actions[bot] |
| 2026-09-05 | `3485018` | feat: introduce context meter to track and display agent token usage and budgeting | Happyesss |
| 2026-09-05 | `2108acc` | chore: bump version to 0.2.100 [skip ci] | github-actions[bot] |
| 2026-09-05 | `6259f4f` | Merge pull request #303 from ANCIENTINSANE/contrib/ancientinsane-agent-org-sync | Surendra Codes |
| 2026-09-05 | `76b6b22` | checkpoint before checking out main | ANCIENTINSANE |
| 2026-09-05 | `6f733c8` | chore: bump version to 0.2.99 [skip ci] | github-actions[bot] |
| 2026-09-05 | `77834c5` | Merge pull request #302 from ANCIENTINSANE/contrib/ancientinsane-agent-org-sync | Surendra Codes |
| 2026-09-05 | `4d69739` | Merge stemlen/main into contrib branch for cross-repo contribution | ANCIENTINSANE |
| 2026-09-05 | `e0a995a` | Ship leftover org invite, agent board, and docs-hook work. | ANCIENTINSANE |
| 2026-09-05 | `7a39a96` | Raise agent model timeouts and pass attached specs to subject sub-agents. | ANCIENTINSANE |
| 2026-09-04 | `f5a80e2` | chore: bump version to 0.2.98 [skip ci] | github-actions[bot] |
| 2026-09-04 | `fe8e336` | Merge pull request #300 from Happyesss/main | Shashank Kumar Rathour |
| 2026-09-04 | `13c0f8e` | feat: add Fairlx Agent harness with plugins, GitHub PRs, and isolated jobs | ANCIENTINSANE |
| 2026-09-04 | `5374c1c` | chore: bump version to 0.2.97 [skip ci] | github-actions[bot] |
| 2026-09-04 | `dd9c18e` | feat: enhance pending confirmation handling and improve write tool call detection | Happyesss |
| 2026-09-04 | `a49f12d` | chore: bump version to 0.2.96 [skip ci] | github-actions[bot] |
| 2026-09-04 | `94a5580` | Merge pull request #299 from Happyesss/main | Shashank Kumar Rathour |
| 2026-09-04 | `715640b` | chore: bump version to 0.2.95 [skip ci] | github-actions[bot] |
| 2026-09-04 | `05a058b` | Merge branch 'main' into main | Shashank Kumar Rathour |
| 2026-09-04 | `cfd443d` | chore: bump version to 0.2.94 [skip ci] | github-actions[bot] |
| 2026-09-04 | `40b9db9` | refactor: optimize message and event retrieval using useMemo for performance | Happyesss |
| 2026-09-04 | `e805894` | chore: bump version to 0.2.93 [skip ci] | github-actions[bot] |
| 2026-09-04 | `7901b84` | feat: add AgentFloatingChat component for interactive agent communication | Happyesss |
| 2026-09-03 | `3426bbe` | chore: bump version to 0.2.93 [skip ci] | github-actions[bot] |
| 2026-09-04 | `5c99783` | Merge pull request #298 from Happyesss/main | Shashank Kumar Rathour |
| 2026-09-03 | `5c24ef5` | chore: bump version to 0.2.92 [skip ci] | github-actions[bot] |
| 2026-09-04 | `16f1b6d` | feat: implement personalized agent training workflows, task prioritization, and project team management tools. | Happyesss |
| 2026-09-03 | `ab595ff` | chore: bump version to 0.2.91 [skip ci] | github-actions[bot] |
| 2026-09-03 | `b8eb6dd` | refactor: standardize priority UI logic and introduce modular project-based quick actions for agent commands | Happyesss |
| 2026-09-02 | `7cf95d2` | chore: bump version to 0.2.90 [skip ci] | github-actions[bot] |
| 2026-09-03 | `6661845` | feat: introduce personal agent functionality with new tools, update environment configurations, and enhance agent run management | Happyesss |
| 2026-09-01 | `9f29adb` | chore: bump version to 0.2.89 [skip ci] | github-actions[bot] |
| 2026-09-02 | `3481abe` | Merge pull request #297 from Happyesss/main | Shashank Kumar Rathour |
| 2026-09-01 | `b14b78f` | chore: bump version to 0.2.88 [skip ci] | github-actions[bot] |
| 2026-09-02 | `36d43ba` | refactor: add runtime-scoped run management to AgentScopeBar and conditionally toggle Grok availability based on environment configuration | Happyesss |
| 2026-09-01 | `531c9d9` | chore: bump version to 0.2.87 [skip ci] | github-actions[bot] |
| 2026-09-02 | `2ba8883` | Merge pull request #296 from Happyesss/main | Shashank Kumar Rathour |
| 2026-09-01 | `b37fa04` | chore: bump version to 0.2.86 [skip ci] | github-actions[bot] |
| 2026-09-02 | `e791b19` | feat: add workspace member removal, implement intent compiler for work item queries, and introduce agent-side member/work-item table components. | Happyesss |
| 2026-09-01 | `9f76456` | chore: bump version to 0.2.85 [skip ci] | github-actions[bot] |
| 2026-09-01 | `a3a5d2e` | feat: add Grok 4.6 support, introduce run deletion confirmation, and refine MCP work item pagination and polling logic. | Happyesss |
| 2026-09-01 | `589cab6` | chore: bump version to 0.2.84 [skip ci] | github-actions[bot] |
| 2026-09-01 | `05ee50e` | feat: add collapsible navigation sections to agent app shell and remove unused model picker and mode switcher | Happyesss |
| 2026-09-01 | `950b4f7` | chore: bump version to 0.2.83 [skip ci] | github-actions[bot] |
| 2026-09-01 | `ebccefa` | Merge pull request #295 from Happyesss/main | Shashank Kumar Rathour |
| 2026-09-01 | `41cd28d` | chore: bump version to 0.2.82 [skip ci] | github-actions[bot] |
| 2026-09-01 | `af9d275` | refactor: implement adaptive message truncation logic with priority for assistant content and add comprehensive test suite for tool loops and state management | Happyesss |
| 2026-08-31 | `bce5065` | chore: bump version to 0.2.81 [skip ci] | github-actions[bot] |
| 2026-09-01 | `c10f872` | Merge pull request #294 from Happyesss/main | Shashank Kumar Rathour |
| 2026-08-31 | `c2d53c1` | chore: bump version to 0.2.80 [skip ci] | github-actions[bot] |
| 2026-09-01 | `c3c8fda` | feat: add workspace member management and user profile lookup to MCP runtime | Happyesss |
| 2026-08-31 | `9b686e2` | chore: bump version to 0.2.79 [skip ci] | github-actions[bot] |
| 2026-09-01 | `fd92b85` | feat: add project selection to workflow view and exclude internal servers from external MCP counts | Happyesss |
| 2026-08-31 | `ae4218a` | chore: bump version to 0.2.78 [skip ci] | github-actions[bot] |
| 2026-09-01 | `8a1701e` | refactor: update agent dashboard UI components to use standardized design system tokens and typography | Happyesss |
| 2026-08-31 | `a91edfc` | chore: bump version to 0.2.77 [skip ci] | github-actions[bot] |
| 2026-09-01 | `41bee0b` | Merge pull request #293 from Happyesss/main | Shashank Kumar Rathour |
| 2026-08-31 | `9121a98` | chore: bump version to 0.2.76 [skip ci] | github-actions[bot] |
| 2026-09-01 | `263ce1f` | refactor: improve performance with useMemo hooks, strengthen agent runtime type safety, and update deployment environment variables. | Happyesss |
| 2026-08-31 | `b359c75` | chore: bump version to 0.2.75 [skip ci] | github-actions[bot] |
| 2026-08-31 | `bdab4c8` | Merge pull request #292 from ANCIENTINSANE/main | Shashank Kumar Rathour |
| 2026-08-31 | `fd1ef9c` | Changes — harness staging (paths, status, branch) | ANCIENTINSANE |
| 2026-08-31 | `a095820` | feat: expand agent harness with specialists, MCP, and chat ops | ANCIENTINSANE |
| 2026-08-31 | `a83ccf3` | fix: keep agent workflow live while model turns run in the background | ANCIENTINSANE |
| 2026-08-31 | `c54459b` | chore: bump version to 0.2.74 [skip ci] | github-actions[bot] |
| 2026-08-31 | `45ab287` | Merge pull request #291 from ANCIENTINSANE/main | Shashank Kumar Rathour |
| 2026-08-31 | `8050192` | feat: replace static agent dashboard with live harness screens and run loop | ANCIENTINSANE |
| 2026-08-31 | `bc96244` | fix: add targeted setup for agent MCP and AI Appwrite collections | ANCIENTINSANE |

Last generated: 2026-09-07T18:55:59.220Z
