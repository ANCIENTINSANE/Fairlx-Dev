import { describe, expect, it } from "vitest";

import { isSafeInAppPath, normalizeZoom, parsePageUiAction } from "./page-ui-action";

describe("parsePageUiAction", () => {
  it("parses set_view and zoom aliases", () => {
    expect(parsePageUiAction({ action: "set_view", view: "kanban" })).toEqual({
      ok: true,
      value: { action: "set_view", view: "kanban", zoom: undefined, filters: undefined, itemId: undefined, path: undefined },
    });
    expect(normalizeZoom("days")).toBe("TODAY");
    expect(normalizeZoom("weeks")).toBe("WEEKS");
    const zoom = parsePageUiAction({ action: "set_zoom", zoom: "Days" });
    expect(zoom).toMatchObject({ ok: true, value: { action: "set_zoom", zoom: "TODAY" } });
  });

  it("rejects unknown actions and missing fields", () => {
    expect(parsePageUiAction({ action: "click_dom" }).ok).toBe(false);
    expect(parsePageUiAction({ action: "set_view" }).ok).toBe(false);
    expect(parsePageUiAction({ action: "navigate" }).ok).toBe(false);
    expect(parsePageUiAction({ action: "select_item" }).ok).toBe(false);
  });

  it("only allows in-app navigate paths", () => {
    expect(isSafeInAppPath("/workspaces/ws1/timeline", "ws1")).toBe(true);
    expect(isSafeInAppPath("/agent/dashboard", "ws1")).toBe(true);
    expect(isSafeInAppPath("https://evil.example", "ws1")).toBe(false);
    expect(isSafeInAppPath("//evil.example", "ws1")).toBe(false);
    expect(isSafeInAppPath("/workspaces/other/timeline", "ws1")).toBe(false);
    expect(isSafeInAppPath("/workspaces/ws1/../settings", "ws1")).toBe(false);
  });
});
