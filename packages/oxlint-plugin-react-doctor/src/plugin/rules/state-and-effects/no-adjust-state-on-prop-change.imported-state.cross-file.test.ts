import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";

const consumer = `
import { useEffect, useState } from "react";
import { usePanel } from "./usePanel";
export function Panel({ onNotice, current }) {
  const { selection } = usePanel(onNotice);
  const [draft, setDraft] = useState(false);
  useEffect(() => { setDraft(false); }, [selection]);
  return draft;
}`;

const provider = `
import { useState } from "react";
export function usePanel(onNotice) {
  const [selection, setSelection] = useState(null);
  const select = (value) => { setSelection(value); };
  const notify = () => { onNotice(); };
  return { selection, select, notify };
}`;

const viteConfig = `
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
const host = process.env.DEV_HOST;
export default defineConfig(async () => ({ plugins: [react()], server: { host: host || false } }));`;

interface Fixture {
  source?: string;
  helper?: string;
  sidecars?: Record<string, string>;
}

const runFixture = ({ source = consumer, helper = provider, sidecars = {} }: Fixture = {}) => {
  const folder = mkdtempSync(join(tmpdir(), "imported-hook-state-field-"));
  try {
    writeFileSync(
      join(folder, "package.json"),
      '{"private":true,"scripts":{"build":"vite build"},"dependencies":{"react":"19.2.3"},"devDependencies":{"vite":"7.3.1","@vitejs/plugin-react":"4.7.0"}}',
    );
    writeFileSync(join(folder, "vite.config.ts"), viteConfig);
    writeFileSync(join(folder, "usePanel.ts"), helper);
    for (const [name, contents] of Object.entries(sidecars)) {
      writeFileSync(join(folder, name), contents);
    }
    const result = runRule(noAdjustStateOnPropChange, source, {
      filename: join(folder, "Panel.tsx"),
    });
    expect(result.parseErrors).toEqual([]);
    return result.diagnostics;
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
};

describe("locally owned state returned by a relative hook", () => {
  it("treats a state field separately from callbacks exposed by the hook", () => {
    expect(runFixture()).toEqual([]);
  });

  it.each<[string, Fixture]>([
    [
      "a second dependency resolves to a prop",
      { source: consumer.replace("[selection]", "[selection, current]") },
    ],
    [
      "the hook parameter feeds the state directly",
      { helper: provider.replace("useState(null)", "useState(onNotice)") },
    ],
    [
      "the hook parameter can choose the writer path",
      {
        helper: provider.replace(
          "onNotice();",
          "try { onNotice(); setSelection(0); } catch { setSelection(1); }",
        ),
      },
    ],
    [
      "the hook passes its writer to another function",
      { helper: provider.replace("onNotice();", "onNotice(setSelection);") },
    ],
    [
      "an opaque wrapper receives the notification closure",
      { helper: provider.replace("() => { onNotice(); }", "register(() => { onNotice(); })") },
    ],
    [
      "the export was reassigned",
      { helper: provider + "\nusePanel = (onNotice) => ({ selection: onNotice });" },
    ],
    [
      "destructuring reassigns the module binding",
      { helper: provider + "\n[usePanel] = [(onNotice) => ({ selection: onNotice })];" },
    ],
    [
      "another source can win extension resolution",
      {
        sidecars: {
          "usePanel.js": "export function usePanel(value) { return { selection: value }; }",
        },
      },
    ],
    [
      "Vite remaps the relative import",
      {
        sidecars: {
          "vite.config.ts":
            'import { defineConfig } from "vite"; export default defineConfig({ resolve: { alias: { "./usePanel": "./alternate" } } });',
        },
      },
    ],
    [
      "a package maps the provider in browser builds",
      { sidecars: { "package.json": '{"browser":{"./usePanel.ts":"./alternate.ts"}}' } },
    ],
  ])("retains the warning when %s", (_reason, fixture) => {
    expect(runFixture(fixture)).toHaveLength(1);
  });
});
