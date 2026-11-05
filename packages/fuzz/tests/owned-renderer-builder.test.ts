import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { ruleRegistry } from "../../oxlint-plugin-react-doctor/src/plugin/rule-registry.js";
import { resetFilesystemCaches } from "../../oxlint-plugin-react-doctor/src/plugin/utils/reset-filesystem-caches.js";
import { runRule } from "../../oxlint-plugin-react-doctor/src/test-utils/run-rule.js";
import { buildVerdictPreservingVariants } from "../src/verdict-preserving-variants.js";

interface BuilderMutationCase {
  name: string;
  source: string;
}

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-builder-variants-"));
const filename = path.join(temporaryDirectory, "entry.tsx");
const builderSource = `import { Renderer, Marked } from "marked";
import { useEffect, useState } from "react";
const format = source => {
  const records = [];
  const counts = new Map();
  const markdown = new Marked({ gfm: true });
  markdown.use({ renderer: { code(token) {
    const label = token.text;
    const count = (counts.get(label) ?? 0) + 1;
    counts.set(label, count);
    records.push({ label, count });
    return Renderer.prototype.code.call(this, token);
  } } });
  const html = markdown.parse(source, { async: false });
  return { html, records };
};
const pause = (milliseconds, signal) => new Promise(settle => {
  if (signal.aborted) { settle(false); return; }
  const timer = setTimeout(() => {
    signal.removeEventListener("abort", cancel);
    settle(true);
  }, milliseconds);
  const cancel = () => { clearTimeout(timer); settle(false); };
  signal.addEventListener("abort", cancel, { once: true });
});
export const View = ({ revision }) => {
  const [status, setStatus] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const run = async () => {
      if (!(await pause(24, controller.signal))) return;
      format("quay");
      if (!(await pause(24, controller.signal))) return;
      setStatus("ready");
    };
    run();
    return () => controller.abort();
  }, [revision]);
  return <div>{status}</div>;
};`;

const cases: ReadonlyArray<BuilderMutationCase> = [
  {
    name: "native array seed",
    source: builderSource.replace(
      "const records = [];",
      "const records = [new AbortController()];",
    ),
  },
  {
    name: "native map insertion",
    source: builderSource.replace(
      "counts.set(label, count)",
      "counts.set(label, new AbortController())",
    ),
  },
  {
    name: "publication before parse",
    source: builderSource.replace("  const html", "  publish(records);\n  const html"),
  },
];

fs.writeFileSync(
  path.join(temporaryDirectory, "package.json"),
  JSON.stringify({
    dependencies: { react: "^19.0.0", "react-dom": "^19.0.0", next: "^16.0.0", marked: "18.0.14" },
  }),
);

afterAll(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));

const diagnosticsFor = (source: string): number => {
  fs.writeFileSync(filename, source);
  resetFilesystemCaches();
  const rule = ruleRegistry["no-set-state-after-await-in-effect"];
  if (!rule) throw new Error("Missing continuation rule");
  const result = runRule(rule, source, { filename });
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics.length;
};

describe("owned renderer builder verdict robustness", () => {
  it("retains repeated acyclic signal uses and the recursive refusal under default rewrites", () => {
    const repeatedSource = builderSource
      .replace(
        "const controller = new AbortController();",
        "const controller = new AbortController(); const { signal } = controller; const inspectToken = token => { const localToken = token; return localToken.aborted; };",
      )
      .replaceAll("pause(24, controller.signal)", "pause(24, signal)")
      .replace(
        "const run = async () => {",
        "const run = async () => { inspectToken(signal); inspectToken(signal);",
      );
    const recursiveSource = repeatedSource.replace(
      "return localToken.aborted;",
      "return inspectToken(localToken);",
    );
    for (const testCase of [
      { source: repeatedSource, expectedWarnings: 0 },
      { source: recursiveSource, expectedWarnings: 1 },
    ]) {
      expect(diagnosticsFor(testCase.source)).toBe(testCase.expectedWarnings);
      const variants = buildVerdictPreservingVariants(testCase.source, filename).filter(
        (variant) => variant.mustPreserveVerdict,
      );
      expect(variants.length).toBeGreaterThan(0);
      for (const variant of variants) {
        expect(diagnosticsFor(variant.code), variant.label).toBe(testCase.expectedWarnings);
      }
    }
  });

  it("retains the quiet builder and renewed barrier anchor", () => {
    expect(diagnosticsFor(builderSource)).toBe(0);
  });

  it.each(cases)(
    "keeps warning for $name under existing verdict-preserving rewrites",
    (testCase) => {
      expect(diagnosticsFor(testCase.source)).toBeGreaterThan(0);
      const variants = buildVerdictPreservingVariants(testCase.source, filename).filter(
        (variant) => variant.mustPreserveVerdict,
      );
      expect(variants.length).toBeGreaterThan(0);
      for (const variant of variants) {
        expect(diagnosticsFor(variant.code), variant.label).toBeGreaterThan(0);
      }
    },
  );
});
