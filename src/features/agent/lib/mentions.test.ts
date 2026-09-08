import { describe, expect, it } from "vitest";

import { extractWorkItemKey, extractDiscordInteractionText, mentionsFairlxAuto, parseFairlxMention } from "./mentions";

describe("Fairlx mention parsing", () => {
  it("distinguishes @Fairlx from @Fairlx-auto", () => {
    expect(parseFairlxMention("Please @Fairlx take a look")).toBe("fairlx");
    expect(parseFairlxMention("Ship it @Fairlx-auto")).toBe("fairlx-auto");
    expect(parseFairlxMention("cc @fairlx_auto on WEB-12")).toBe("fairlx-auto");
    expect(parseFairlxMention("hello team")).toBeNull();
  });

  it("treats @Fairlx-auto as auto even when both appear", () => {
    expect(parseFairlxMention("@Fairlx and also @Fairlx-auto")).toBe("fairlx-auto");
    expect(mentionsFairlxAuto("<p>@Fairlx-auto fix this</p>")).toBe(true);
  });

  it("extracts a work-item key from chat text", () => {
    expect(extractWorkItemKey("Look at WEB-12 please")).toBe("WEB-12");
    expect(extractWorkItemKey("no key here")).toBeUndefined();
  });

  it("flattens Discord slash payloads into mention text", () => {
    expect(
      parseFairlxMention(
        extractDiscordInteractionText({
          data: {
            name: "fairlx",
            options: [{ name: "text", value: "@Fairlx-auto please ship WEB-12" }],
          },
        }),
      ),
    ).toBe("fairlx-auto");
  });
});
