import { describe, expect, it } from "vitest";

import { parseFairlxMention } from "./mentions";
import { autonomousCodingEnabled, skipCodingLoopConfirmation } from "./auto-mode";

describe("inbound mention to bound run", () => {
  it("maps @Fairlx-auto to autonomous coding", () => {
    expect(parseFairlxMention("hey @Fairlx-auto ship WEB-1")).toBe("fairlx-auto");
    expect(
      autonomousCodingEnabled({
        mentionAuto: parseFairlxMention("hey @Fairlx-auto ship WEB-1") === "fairlx-auto",
        settings: { permissionType: "staged" },
      }),
    ).toBe(true);
  });

  it("keeps staged @Fairlx from skipping coding-loop Accepts", () => {
    expect(
      autonomousCodingEnabled({
        mentionAuto: parseFairlxMention("hey @Fairlx ship WEB-1") === "fairlx-auto",
        settings: { permissionType: "staged" },
      }),
    ).toBe(false);
    expect(
      skipCodingLoopConfirmation({ id: "1", name: "coding_session_start", arguments: "{}" }, false),
    ).toBe(false);
    expect(
      skipCodingLoopConfirmation({ id: "1", name: "coding_session_start", arguments: "{}" }, true),
    ).toBe(true);
  });
});
