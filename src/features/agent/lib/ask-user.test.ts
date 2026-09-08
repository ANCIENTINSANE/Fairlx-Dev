import { describe, expect, it } from "vitest";

import {
  applyUserAnswerToPendingQuestion,
  findPendingAskUser,
  normalizeAskUserOptions,
  parseAskUserArgs,
  parseAskUserFromMessage,
  splitChoiceLabel,
} from "./ask-user";
import type { AgentChatMessage, AgentToolEvent } from "../types";

const now = "2026-09-08T00:00:00.000Z";

describe("ask_user parsing", () => {
  it("keeps at most three unique short options and drops Other", () => {
    expect(
      normalizeAskUserOptions(["Yes, Tech Lead", "Frontend", "Yes, Tech Lead", "QA", "PM", "Other"]),
    ).toEqual(["Yes, Tech Lead", "Frontend", "QA"]);
  });

  it("drops reserved custom labels so the UI can add Type your own", () => {
    expect(normalizeAskUserOptions(["Other", "Type your own…", "Keep README", "Wipe everything"])).toEqual([
      "Keep README",
      "Wipe everything",
    ]);
  });

  it("joins object options with a description and splits them for display", () => {
    expect(
      normalizeAskUserOptions([
        { label: "Wipe everything", description: "delete README, items, and sprints" },
        { title: "Keep the README", description: "rebuild the plan" },
      ]),
    ).toEqual([
      "Wipe everything — delete README, items, and sprints",
      "Keep the README — rebuild the plan",
    ]);
    expect(splitChoiceLabel("Wipe everything — delete README, items, and sprints")).toEqual({
      title: "Wipe everything",
      description: "delete README, items, and sprints",
    });
    expect(splitChoiceLabel("Keep sprints & items - rebuild from scratch")).toEqual({
      title: "Keep sprints & items",
      description: "rebuild from scratch",
    });
  });

  it("reads question and options from tool arguments", () => {
    const parsed = parseAskUserArgs(
      JSON.stringify({
        question: "Does Tech Lead sound right?",
        options: ["Yes, Tech Lead", "Frontend Engineer", "Infer from workspace"],
        allowCustom: true,
      }),
    );
    expect(parsed.question).toBe("Does Tech Lead sound right?");
    expect(parsed.options).toHaveLength(3);
    expect(parsed.allowCustom).toBe(true);
  });

  it("finds a pending question from an unmatched ask_user call", () => {
    const messages: AgentChatMessage[] = [
      {
        id: "a1",
        role: "assistant",
        content: "Does Tech Lead sound right?",
        toolCalls: [
          {
            id: "call_1",
            name: "ask_user",
            arguments: JSON.stringify({
              question: "Does Tech Lead sound right?",
              options: ["Yes, Tech Lead", "Frontend Engineer", "Infer from workspace"],
            }),
          },
        ],
        createdAt: now,
      },
    ];
    const pending = findPendingAskUser(messages, []);
    expect(pending?.toolCallId).toBe("call_1");
    expect(pending?.options[0]).toBe("Yes, Tech Lead");
  });

  it("appends a tool result when the user answers", () => {
    const messages: AgentChatMessage[] = [
      {
        id: "a1",
        role: "assistant",
        content: "Pick a role",
        toolCalls: [
          {
            id: "call_1",
            name: "ask_user",
            arguments: JSON.stringify({
              question: "Pick a role",
              options: ["Tech Lead", "Frontend Engineer"],
            }),
          },
        ],
        createdAt: now,
      },
    ];
    const events: AgentToolEvent[] = [
      {
        id: "e1",
        type: "ask_user",
        title: "Pick a role",
        payload: {
          question: "Pick a role",
          options: ["Tech Lead", "Frontend Engineer"],
          allowCustom: true,
          toolCallId: "call_1",
        },
        createdAt: now,
        runId: "run1",
      },
    ];
    const next = applyUserAnswerToPendingQuestion({ messages, events }, "Tech Lead");
    expect(next.messages[1]?.role).toBe("user");
    expect(next.messages[2]?.role).toBe("tool");
    expect(next.messages[2]?.toolCallId).toBe("call_1");
    expect(next.events.at(-1)?.type).toBe("ask_user_resolved");
    expect(findPendingAskUser(next.messages, next.events)).toBeUndefined();
  });

  it("reads ask_user from the assistant message even without an event", () => {
    const pending = parseAskUserFromMessage({
      id: "a1",
      role: "assistant",
      content: "How blunt should I be?",
      toolCalls: [
        {
          id: "c1",
          name: "ask_user",
          arguments: JSON.stringify({ question: "How blunt?", options: ["Direct", "Warm"] }),
        },
      ],
      createdAt: now,
    });
    expect(pending?.options).toEqual(["Direct", "Warm"]);
  });
});
