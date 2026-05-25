import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { collectRuleHits, setupReactProject } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-react-ui-rules-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("design-no-redundant-padding-axes", () => {
  it("flags px-N py-N where N is the same value", async () => {
    const projectDir = setupReactProject(tempRoot, "no-padding-axes-pos", {
      files: {
        "src/Button.tsx": `export const Button = () => <button className="px-4 py-4 rounded">Save</button>;\n`,
      },
    });

    const hits = await collectRuleHits(projectDir, "design-no-redundant-padding-axes");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("p-4");
  });

  it("does not flag px-N py-M when N ≠ M", async () => {
    const projectDir = setupReactProject(tempRoot, "no-padding-axes-neg", {
      files: {
        "src/Button.tsx": `export const Button = () => <button className="px-4 py-2 rounded">Save</button>;\n`,
      },
    });

    const hits = await collectRuleHits(projectDir, "design-no-redundant-padding-axes");
    expect(hits).toHaveLength(0);
  });

  it("does not flag when an axis varies by breakpoint", async () => {
    const projectDir = setupReactProject(tempRoot, "no-padding-axes-breakpoint", {
      files: {
        "src/Hero.tsx": `export const Hero = () => <section className="px-4 py-4 sm:py-6">Hi</section>;\n`,
      },
    });

    const hits = await collectRuleHits(projectDir, "design-no-redundant-padding-axes");
    expect(hits).toHaveLength(0);
  });

  it("reports every matching pair when the same axis appears multiple times", async () => {
    // Regression: the trailing axis-pattern boundary used to consume the
    // whitespace between tokens, breaking matchAll's ability to find
    // `px-6` after `px-4`. With both pairs present, the rule must report
    // both `p-4` and `p-6`.
    const projectDir = setupReactProject(tempRoot, "no-padding-axes-multi", {
      files: {
        "src/Box.tsx": `export const Box = () => <div className="px-4 px-6 py-4 py-6">Hi</div>;\n`,
      },
    });

    const hits = await collectRuleHits(projectDir, "design-no-redundant-padding-axes");
    expect(hits).toHaveLength(2);
    expect(hits.some((hit) => hit.message.includes("p-4"))).toBe(true);
    expect(hits.some((hit) => hit.message.includes("p-6"))).toBe(true);
  });
});

describe("design-no-redundant-size-axes", () => {
  it("flags w-N h-N where N is the same value", async () => {
    const projectDir = setupReactProject(tempRoot, "no-size-axes-pos", {
      files: {
        "src/Avatar.tsx": `export const Avatar = () => <div className="w-10 h-10 rounded-full" />;\n`,
      },
    });

    const hits = await collectRuleHits(projectDir, "design-no-redundant-size-axes", {
      tailwindVersion: "^3.4.0",
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("size-10");
  });

  it("reports every matching pair when the same axis appears multiple times", async () => {
    const projectDir = setupReactProject(tempRoot, "no-size-axes-multi", {
      files: {
        "src/Pair.tsx": `export const Pair = () => <div className="w-8 w-10 h-8 h-10" />;\n`,
      },
    });

    const hits = await collectRuleHits(projectDir, "design-no-redundant-size-axes", {
      tailwindVersion: "^3.4.0",
    });
    expect(hits).toHaveLength(2);
    expect(hits.some((hit) => hit.message.includes("size-8"))).toBe(true);
    expect(hits.some((hit) => hit.message.includes("size-10"))).toBe(true);
  });

  it("does not flag fractional widths (w-1/2 h-1/2)", async () => {
    const projectDir = setupReactProject(tempRoot, "no-size-axes-fractional", {
      files: {
        "src/Split.tsx": `export const Split = () => <div className="w-1/2 h-1/2" />;\n`,
      },
    });

    const hits = await collectRuleHits(projectDir, "design-no-redundant-size-axes", {
      tailwindVersion: "^3.4.0",
    });
    expect(hits).toHaveLength(0);
  });

  it("fires on Tailwind v3.4 (the version that introduced size-N)", async () => {
    const projectDir = setupReactProject(tempRoot, "no-size-axes-tw-3-4", {
      files: {
        "src/Avatar.tsx": `export const Avatar = () => <div className="w-10 h-10" />;\n`,
      },
    });

    const hits = await collectRuleHits(projectDir, "design-no-redundant-size-axes", {
      tailwindVersion: "^3.4.0",
    });
    expect(hits).toHaveLength(1);
  });

  it("fires on Tailwind v4 (size-N inherited from v3.4+)", async () => {
    const projectDir = setupReactProject(tempRoot, "no-size-axes-tw-4", {
      files: {
        "src/Avatar.tsx": `export const Avatar = () => <div className="w-10 h-10" />;\n`,
      },
    });

    const hits = await collectRuleHits(projectDir, "design-no-redundant-size-axes", {
      tailwindVersion: "^4.0.0",
    });
    expect(hits).toHaveLength(1);
  });

  it("stays silent on Tailwind v3.3 (size-N would not compile there)", async () => {
    const projectDir = setupReactProject(tempRoot, "no-size-axes-tw-3-3", {
      files: {
        "src/Avatar.tsx": `export const Avatar = () => <div className="w-10 h-10" />;\n`,
      },
    });

    const hits = await collectRuleHits(projectDir, "design-no-redundant-size-axes", {
      tailwindVersion: "^3.3.0",
    });
    expect(hits).toHaveLength(0);
  });

  it("stays silent on Tailwind v2 (predates the size-N shorthand entirely)", async () => {
    const projectDir = setupReactProject(tempRoot, "no-size-axes-tw-2", {
      files: {
        "src/Avatar.tsx": `export const Avatar = () => <div className="w-10 h-10" />;\n`,
      },
    });

    const hits = await collectRuleHits(projectDir, "design-no-redundant-size-axes", {
      tailwindVersion: "^2.2.0",
    });
    expect(hits).toHaveLength(0);
  });

  it("fires when tailwindVersion is unparseable — assume latest, surface the rule", async () => {
    const projectDir = setupReactProject(tempRoot, "no-size-axes-tw-null", {
      files: {
        "src/Avatar.tsx": `export const Avatar = () => <div className="w-10 h-10" />;\n`,
      },
    });

    const hits = await collectRuleHits(projectDir, "design-no-redundant-size-axes", {
      tailwindVersion: "latest",
    });
    expect(hits).toHaveLength(1);
  });
});

describe("design-no-space-on-flex-children", () => {
  it("flags space-x on a flex parent and suggests gap-x (preserving the axis)", async () => {
    const projectDir = setupReactProject(tempRoot, "no-space-on-flex-pos", {
      files: {
        "src/Row.tsx": `export const Row = () => (
  <div className="flex space-x-4">
    <span>a</span>
    <span>b</span>
  </div>
);
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "design-no-space-on-flex-children");
    expect(hits).toHaveLength(1);
    // Regression: bare `gap-4` would also add vertical gap, changing
    // layout. The suggestion must preserve the axis: `gap-x-4`.
    expect(hits[0].message).toContain("gap-x-4");
    expect(hits[0].message).not.toMatch(/gap-4(?!\d)/);
  });

  it("does not flag space-y on a plain block parent", async () => {
    const projectDir = setupReactProject(tempRoot, "no-space-on-flex-neg", {
      files: {
        "src/Article.tsx": `export const Article = () => (
  <article className="space-y-4">
    <p>one</p>
    <p>two</p>
  </article>
);
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "design-no-space-on-flex-children");
    expect(hits).toHaveLength(0);
  });

  it("flags space-x on a responsive flex parent (md:flex)", async () => {
    const projectDir = setupReactProject(tempRoot, "no-space-on-flex-responsive", {
      files: {
        "src/Row.tsx": `export const Row = () => <div className="md:flex space-x-2">a</div>;\n`,
      },
    });

    const hits = await collectRuleHits(projectDir, "design-no-space-on-flex-children");
    expect(hits).toHaveLength(1);
  });
});

describe("design-no-three-period-ellipsis", () => {
  it("flags three-period ellipses after letters", async () => {
    const projectDir = setupReactProject(tempRoot, "no-three-period-pos", {
      files: {
        "src/Spinner.tsx": `export const Spinner = () => <span>Loading...</span>;\n`,
      },
    });

    const hits = await collectRuleHits(projectDir, "design-no-three-period-ellipsis");
    expect(hits).toHaveLength(1);
  });

  it("does not flag the typographic ellipsis character", async () => {
    const projectDir = setupReactProject(tempRoot, "no-three-period-neg", {
      files: {
        "src/Spinner.tsx": `export const Spinner = () => <span>Loading\u2026</span>;\n`,
      },
    });

    const hits = await collectRuleHits(projectDir, "design-no-three-period-ellipsis");
    expect(hits).toHaveLength(0);
  });

  it("does not flag inside <code> / <pre> / translate=no", async () => {
    const projectDir = setupReactProject(tempRoot, "no-three-period-neg-code", {
      files: {
        "src/Snippet.tsx": `export const Snippet = () => (
  <pre><code>const xs = [a...rest]</code></pre>
);
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "design-no-three-period-ellipsis");
    expect(hits).toHaveLength(0);
  });
});

describe("design-no-em-dash-in-jsx-text", () => {
  it("flags em dashes in JSX text", async () => {
    const projectDir = setupReactProject(tempRoot, "no-em-dash-pos", {
      files: {
        "src/Message.tsx": `export const Message = () => <p>Ready — deploy now</p>;\n`,
      },
    });

    const hits = await collectRuleHits(projectDir, "design-no-em-dash-in-jsx-text");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("Em dash");
  });

  it("does not flag em dashes in code-like or non-translated text", async () => {
    const projectDir = setupReactProject(tempRoot, "no-em-dash-neg", {
      files: {
        "src/Snippet.tsx": `export const Snippet = () => (
  <div>
    <code>git log --oneline — docs</code>
    <span translate="no">Acme — Internal</span>
  </div>
);
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "design-no-em-dash-in-jsx-text");
    expect(hits).toHaveLength(0);
  });
});

describe("design-no-vague-button-label", () => {
  it("flags vague <button> labels", async () => {
    const projectDir = setupReactProject(tempRoot, "no-vague-button-pos", {
      files: {
        "src/Form.tsx": `export const Form = () => (
  <form>
    <button>Continue</button>
    <button>Submit</button>
    <button>OK</button>
    <button>Click here</button>
  </form>
);
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "design-no-vague-button-label");
    expect(hits).toHaveLength(4);
  });

  it("does not flag specific labels", async () => {
    const projectDir = setupReactProject(tempRoot, "no-vague-button-neg", {
      files: {
        "src/Form.tsx": `export const Form = () => (
  <form>
    <button>Save changes</button>
    <button>Send invite</button>
    <button>Delete account</button>
  </form>
);
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "design-no-vague-button-label");
    expect(hits).toHaveLength(0);
  });

  it("does not flag <button> with nested elements (icon + text)", async () => {
    const projectDir = setupReactProject(tempRoot, "no-vague-button-icon", {
      files: {
        "src/Form.tsx": `export const Form = () => (
  <button><svg /> Continue</button>
);
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "design-no-vague-button-label");
    expect(hits).toHaveLength(0);
  });
});
