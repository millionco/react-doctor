import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noEmojiHeadingDecoration } from "./no-emoji-heading-decoration.js";

describe("no-emoji-heading-decoration", () => {
  it.each([
    ["direct JSX text", `const Hero = () => <h1>🚀 Ship faster</h1>;`],
    ["a static string expression", `const Hero = () => <h2>{"✨ Reliable by default"}</h2>;`],
    ["a static template", "const Hero = () => <h3>{`⚡ Instant results`}</h3>;"],
    [
      "either static conditional branch",
      `const Hero = ({ isReady }) => <h4>{isReady ? "✅ Ready" : "⏳ Preparing"}</h4>;`,
    ],
    [
      "one static conditional branch beside a dynamic branch",
      `const Hero = ({ title, isReady }) => <h5>{isReady ? "🎉 Complete" : title}</h5>;`,
    ],
    [
      "static text inside intrinsic formatting",
      `const Hero = () => <h6><span><strong>🔥 Built for scale</strong></span></h6>;`,
    ],
    [
      "transparent TypeScript wrappers",
      `const Hero = ({ compact }) => <h1>{(compact ? "📦 Compact" : "🖥️ Desktop") as string}</h1>;`,
    ],
  ])("flags %s", (_description, code) => {
    const result = runRule(noEmojiHeadingDecoration, code);
    expect(result.parseErrors).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["dynamic heading content", `const Hero = ({ title }) => <h1>{title}</h1>;`],
    [
      "a dynamic template binding",
      "const Hero = ({ icon }) => <h1>{`${icon} Product updates`}</h1>;",
    ],
    ["emoji outside a heading", `const Hero = () => <p>🚀 Ship faster</p>;`],
    [
      "an icon component inside a heading",
      `const Hero = () => <h1><RocketIcon aria-hidden="true" /> Ship faster</h1>;`,
    ],
    [
      "emoji owned by an icon component",
      `const Hero = () => <h1><EmojiIcon>🚀</EmojiIcon> Ship faster</h1>;`,
    ],
    [
      "emoji passed to an icon component",
      `const Hero = () => <h1><EmojiIcon symbol="🚀" /> Ship faster</h1>;`,
    ],
    [
      "a logical expression outside the v1 static branch contract",
      `const Hero = ({ enabled }) => <h1>{enabled && "🚀 Launch"}</h1>;`,
    ],
    ["a custom heading component", `const Hero = () => <Heading>🚀 Ship faster</Heading>;`],
    ["a trailing status emoji", `const Hero = () => <h1>Deployment complete ✅</h1>;`],
    [
      "a trailing status emoji inside formatting",
      `const Hero = () => <h1>Deployment complete <span>✅</span></h1>;`,
    ],
    ["an emoji embedded in a product name", `const Hero = () => <h1>Panda 🐼 UI</h1>;`],
  ])("accepts %s", (_description, code) => {
    const result = runRule(noEmojiHeadingDecoration, code);
    expect(result.parseErrors).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    "/repo/docs/getting-started.tsx",
    "/repo/documentation/overview.tsx",
    "/repo/demo/hero.tsx",
    "/repo/examples/landing.tsx",
    "/repo/sandbox/preview.tsx",
    "/repo/playground/surface.tsx",
    "/repo/stories/hero.tsx",
    "/repo/tests/hero.tsx",
    "/repo/src/hero.story.tsx",
    "/repo/src/hero.test.tsx",
  ])("skips conventional non-product path %s", (filename) => {
    const result = runRule(
      noEmojiHeadingDecoration,
      `const Hero = () => <h1>🚀 Ship faster</h1>;`,
      { filename },
    );
    expect(result.parseErrors).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("uses the configured project root when the host reports a relative filename", () => {
    const result = runRule(
      noEmojiHeadingDecoration,
      `const Heading = () => <h1>Panda 🐼 + UI ⚡️</h1>;`,
      {
        filename: "src/App.tsx",
        settings: { "react-doctor": { rootDirectory: "/repo/sandbox/panda-preset" } },
      },
    );
    expect(result.diagnostics).toEqual([]);
  });
});
