"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";

const SCOPES = [
  "commands",
  "chat:write",
  "chat:write.public",
  "app_mentions:read",
  "channels:history",
  "groups:history",
  "im:history",
  "mpim:history",
  "channels:read",
  "users:read",
  "users:read.email",
  "links:read",
  "links:write",
  "incoming-webhook",
];

const EVENTS = ["app_mention", "message.channels", "message.groups", "message.im", "link_shared"];

function CopyLine({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 font-mono text-[11px] text-foreground">
      <span className="min-w-0 flex-1 truncate">{value}</span>
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground"
        aria-label="Copy"
        onClick={() => {
          void navigator.clipboard?.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}

export function SlackSetupGuide({ appUrl }: { appUrl?: string }) {
  const base = (appUrl || (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/+$/, "");
  const eventsUrl = `${base}/api/integrations/slack/events`;
  const oauthUrl = `${base}/api/integrations/slack/oauth/callback`;
  return (
    <div className="space-y-4 text-xs text-muted-foreground">
      <ol className="list-decimal space-y-3 pl-4">
        <li>
          <span className="font-medium text-foreground">Create the Slack app.</span> Go to{" "}
          <a className="underline" href="https://api.slack.com/apps" target="_blank" rel="noreferrer">
            api.slack.com/apps
          </a>{" "}
          → <em>Create New App → From scratch</em>. Name it <strong>Fairlx</strong> and pick your Slack workspace.
        </li>
        <li>
          <span className="font-medium text-foreground">Copy credentials into Fairlx’s environment</span> (Basic Information → App Credentials):
          <div className="mt-1.5 grid gap-1.5">
            <CopyLine value="SLACK_CLIENT_ID=…" />
            <CopyLine value="SLACK_CLIENT_SECRET=…" />
            <CopyLine value="SLACK_SIGNING_SECRET=…" />
          </div>
          Restart the Fairlx server after setting them. The signing secret is what lets Fairlx reject forged requests.
        </li>
        <li>
          <span className="font-medium text-foreground">OAuth &amp; Permissions → Redirect URLs</span>: add
          <div className="mt-1.5">
            <CopyLine value={oauthUrl} />
          </div>
          Then add these <strong>Bot Token Scopes</strong>:
          <div className="mt-1.5 flex flex-wrap gap-1">
            {SCOPES.map((scope) => (
              <code key={scope} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-foreground">
                {scope}
              </code>
            ))}
          </div>
        </li>
        <li>
          <span className="font-medium text-foreground">Slash Commands → Create New Command</span>: command <code className="rounded bg-muted px-1 text-foreground">/fairlx</code>, request URL
          <div className="mt-1.5">
            <CopyLine value={eventsUrl} />
          </div>
          Short description “Control Fairlx”, usage hint <code className="rounded bg-muted px-1 text-foreground">bug &lt;title&gt; · fix &lt;KEY&gt; · list · sessions</code>. Turn on <em>Escape channels, users, and links</em>.
        </li>
        <li>
          <span className="font-medium text-foreground">Event Subscriptions</span>: enable, set the same request URL (Slack will verify it instantly), and subscribe to these bot events:
          <div className="mt-1.5 flex flex-wrap gap-1">
            {EVENTS.map((event) => (
              <code key={event} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-foreground">
                {event}
              </code>
            ))}
          </div>
          Under <em>App unfurl domains</em> add your Fairlx host so work-item links expand in Slack.
        </li>
        <li>
          <span className="font-medium text-foreground">App Home</span>: enable the Messages tab and “Allow users to send Slash commands and messages from the messages tab” so DMs to Fairlx work.
        </li>
        <li>
          <span className="font-medium text-foreground">Install to workspace</span>, then in Fairlx open <em>Project → Settings → Integrations → Slack → Connect</em>. That OAuth step links the Slack workspace to <em>one Fairlx project</em> and stores the bot token. The default channel you pick receives automation and supervisor notifications.
        </li>
        <li>
          <span className="font-medium text-foreground">Invite the bot</span> to the channels you want it to read: <code className="rounded bg-muted px-1 text-foreground">/invite @Fairlx</code>. Without this it cannot see thread replies.
        </li>
      </ol>
      <div className="rounded-lg border border-border bg-card p-3">
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground">Then, from Slack</p>
        <ul className="space-y-1">
          <li><code className="text-foreground">/fairlx bug Checkout button 500s on mobile p1</code> — raises a BUG (priority URGENT) and fires any “Work item created” loop.</li>
          <li><code className="text-foreground">/fairlx fix WEB-12 also add a test</code> — Fairlx starts the sandbox, implements, tests, and replies with the run link.</li>
          <li>Reply <code className="text-foreground">@Fairlx fix this</code> in any thread that contains a key like <code className="text-foreground">WEB-12</code> — or under any message; Fairlx will create the item from the parent message and execute.</li>
          <li><code className="text-foreground">/fairlx list bugs</code> · <code className="text-foreground">/fairlx sessions</code> · <code className="text-foreground">/fairlx close WEB-12 shipped</code> · <code className="text-foreground">/fairlx runs</code> · <code className="text-foreground">/fairlx help</code></li>
        </ul>
      </div>
      <Button asChild size="sm" variant="outline" className="h-7 text-xs">
        <a href="https://api.slack.com/apps" target="_blank" rel="noreferrer">
          Open Slack app dashboard
        </a>
      </Button>
    </div>
  );
}
