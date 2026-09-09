import { describe, expect, it } from "vitest";
import { getFileIconMeta } from "./file-icon";
import {
  SiHtml5,
  SiJavascript,
  SiNextdotjs,
  SiNpm,
  SiPostcss,
  SiReact,
  SiTailwindcss,
  SiTypescript,
  SiVite,
  SiCss3,
  SiDocker,
  SiMarkdown,
} from "react-icons/si";
import { VscJson } from "react-icons/vsc";

describe("getFileIconMeta", () => {
  it("resolves files from the user screenshot correctly", () => {
    // 1. package.json -> SiNpm
    expect(getFileIconMeta("package.json").icon).toBe(SiNpm);
    expect(getFileIconMeta("packages/landing-page/package.json").icon).toBe(SiNpm);

    // 2. index.html -> SiHtml5
    expect(getFileIconMeta("index.html").icon).toBe(SiHtml5);
    expect(getFileIconMeta("packages/landing-page/index.html").icon).toBe(SiHtml5);

    // 3. vite.config.ts -> SiVite
    expect(getFileIconMeta("vite.config.ts").icon).toBe(SiVite);
    expect(getFileIconMeta("packages/landing-page/vite.config.ts").icon).toBe(SiVite);

    // 4. tsconfig.json -> SiTypescript
    expect(getFileIconMeta("tsconfig.json").icon).toBe(SiTypescript);
    expect(getFileIconMeta("packages/landing-page/tsconfig.json").icon).toBe(SiTypescript);

    // 5. tailwind.config.js -> SiTailwindcss
    expect(getFileIconMeta("tailwind.config.js").icon).toBe(SiTailwindcss);
    expect(getFileIconMeta("packages/landing-page/tailwind.config.js").icon).toBe(SiTailwindcss);

    // 6. postcss.config.js -> SiPostcss
    expect(getFileIconMeta("postcss.config.js").icon).toBe(SiPostcss);
    expect(getFileIconMeta("packages/landing-page/postcss.config.js").icon).toBe(SiPostcss);

    // 7. main.tsx, App.tsx, Hero.tsx -> SiReact
    expect(getFileIconMeta("main.tsx").icon).toBe(SiReact);
    expect(getFileIconMeta("packages/landing-page/src/App.tsx").icon).toBe(SiReact);
    expect(getFileIconMeta("packages/landing-page/src/components/Hero.tsx").icon).toBe(SiReact);

    // 8. index.css -> SiCss3
    expect(getFileIconMeta("index.css").icon).toBe(SiCss3);
    expect(getFileIconMeta("packages/landing-page/src/index.css").icon).toBe(SiCss3);
  });

  it("resolves general extensions correctly", () => {
    expect(getFileIconMeta("src/utils/math.ts").icon).toBe(SiTypescript);
    expect(getFileIconMeta("src/utils/calc.js").icon).toBe(SiJavascript);
    expect(getFileIconMeta("data.json").icon).toBe(VscJson);
    expect(getFileIconMeta("README.md").icon).toBe(SiMarkdown);
    expect(getFileIconMeta("Dockerfile").icon).toBe(SiDocker);
    expect(getFileIconMeta("docker-compose.yml").icon).toBe(SiDocker);
    expect(getFileIconMeta("next.config.mjs").icon).toBe(SiNextdotjs);
  });
});
