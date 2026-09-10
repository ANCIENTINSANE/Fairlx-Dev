import { describe, expect, it } from "vitest";

import { detectSessionMode, sessionModeFromContent } from "./mode-router";
import { composeUserPrompt, displayUserContent, resolveTurnMode } from "./session-context";

describe("mode router", () => {
  it("plans when the user wants to build something with nothing connected", () => {
    const decision = detectSessionMode("I just want to build a product", { hasProject: false, hasRepo: false });
    expect(decision.mode).toBe("plan");
    expect(decision.hints.join(" ")).toMatch(/Do not interrogate/);
    expect(decision.hints.join(" ")).toMatch(/name/);
  });

  it("debugs on errors and stack traces", () => {
    expect(detectSessionMode("TypeError: Cannot read properties of undefined (reading 'map')").mode).toBe("debug");
    expect(detectSessionMode("the login button is not working after deploy").mode).toBe("debug");
  });

  it("auto mode treats coding nudges as agent, not ask or plan", () => {
    expect(detectSessionMode("code now").mode).toBe("agent");
    expect(detectSessionMode("yes start coding").mode).toBe("agent");
    expect(detectSessionMode("did you code?").mode).toBe("agent");
    const content = composeUserPrompt("code now", [], "auto", null, { hasRepo: true });
    expect(sessionModeFromContent(content)).toBe("agent");
    expect(content).toMatch(/Do not submit another implementation plan/);
  });

  it("asks for questions, acts for actions, plans for roadmaps", () => {
    expect(detectSessionMode("what is the status of sprint 3?").mode).toBe("ask");
    expect(detectSessionMode("create a bug for the broken login").mode).toBe("debug");
    expect(detectSessionMode("assign FX-12 to Priya").mode).toBe("agent");
    expect(detectSessionMode("give me a roadmap for the mobile app").mode).toBe("plan");
    expect(detectSessionMode("as my chief of staff, coordinate the team on this").mode).toBe("personal");
  });

  it("pinned modes are not re-routed", () => {
    const pinned = resolveTurnMode("what is this?", "debug");
    expect(pinned.mode).toBe("debug");
    expect(pinned.auto).toBe(false);
  });

  it("auto mode tags the composed prompt and stays hidden in the transcript", () => {
    const content = composeUserPrompt("I want to build a SaaS dashboard", [], "auto", null, { hasRepo: false });
    expect(content.startsWith("[Session mode: plan · auto]")).toBe(true);
    expect(sessionModeFromContent(content)).toBe("plan");
    expect(displayUserContent(content)).toBe("I want to build a SaaS dashboard");
  });

  it("expands /plan so the model sees the shortcut but the chat bubble does not", () => {
    const content = composeUserPrompt("/plan add a hamburger menu", [], "auto", null);
    expect(sessionModeFromContent(content)).toBe("plan");
    expect(content).toMatch(/\[Shortcut \/plan\]/);
    expect(displayUserContent(content)).toBe("add a hamburger menu");
  });
});
