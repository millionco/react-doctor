import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rulesOfHooks } from "./rules-of-hooks.js";

const classDeclaration = `
  import { useState } from "react";
  class SlotService {
    useSlots = () => useState(0);
  }
  const service = new SlotService();
`;

const exportedService = classDeclaration
  .replace("class SlotService", "export class SlotService")
  .replace("const service", "export const service");

describe("rules-of-hooks service class fields", () => {
  it.each([
    "export function Board() { service.useSlots(); return null; }",
    "export function useBoard() { return service.useSlots(); }",
    "export function Board() { const { useSlots } = service; useSlots(); return null; }",
    "export function Board() { const run = service.useSlots; run(); return null; }",
  ])("accepts a Hook-valued field used in render: %s", (source) => {
    expect(runRule(rulesOfHooks, classDeclaration + source).diagnostics).toEqual([]);
  });

  it.each([
    "service.useSlots();",
    "const { useSlots: run } = service; run();",
    "const run = service.useSlots; service.useSlots = () => [1, () => {}]; run();",
    "const key = 'useSlots'; service[key]();",
    "new SlotService().useSlots();",
  ])("reports imperative invocation: %s", (source) => {
    expect(
      runRule(rulesOfHooks, classDeclaration + source).diagnostics.map((item) => item.message),
    ).toEqual([expect.stringContaining("`useSlots` can only run inside")]);
  });

  it("reports the call in the constructor", () => {
    const source = classDeclaration.replace(
      "useSlots = () => useState(0);",
      `
      useSlots = () => useState(0);
      constructor() { this.useSlots(); }
    `,
    );
    expect(runRule(rulesOfHooks, source).diagnostics.map((item) => item.message)).toEqual([
      expect.stringContaining("`useSlots` cannot run in a class"),
    ]);
  });

  it("retains conditional and async diagnostics in the field and in its caller", () => {
    const conditionalField = classDeclaration.replace(
      "() => useState(0)",
      "(enabled) => { if (enabled) useState(0); }",
    );
    expect(runRule(rulesOfHooks, conditionalField).diagnostics.map((item) => item.message)).toEqual(
      [expect.stringContaining("`useState` changes Hook order")],
    );
    const asyncField = classDeclaration.replace("() => useState(0)", "async () => useState(0)");
    expect(runRule(rulesOfHooks, asyncField).diagnostics.map((item) => item.message)).toEqual([
      expect.stringContaining("`useState` runs inside an async function"),
    ]);
    const conditionalCaller =
      classDeclaration +
      "export function Board({ enabled }) { if (enabled) service.useSlots(); return null; }";
    expect(
      runRule(rulesOfHooks, conditionalCaller).diagnostics.map((item) => item.message),
    ).toEqual([expect.stringContaining("`useSlots` changes Hook order")]);
  });

  it("preserves genuine React class and non-Hook field findings", () => {
    for (const source of [
      classDeclaration
        .replace("class SlotService", "class SlotService extends Component")
        .replace("{ useState }", "{ Component, useState }"),
      classDeclaration.replace("useSlots =", "readSlots ="),
      classDeclaration.replace("useSlots =", "static useSlots ="),
    ]) {
      expect(runRule(rulesOfHooks, source).diagnostics.map((item) => item.message)).toEqual([
        expect.stringContaining("`useState` cannot run in a class"),
      ]);
    }
  });

  it.each([
    "const callbacks = [service.useSlots]; callbacks[0]();",
    "export function select(enabled) { service[enabled ? 'useSlots' : 'read'](); }",
    "const receivers = [service]; receivers[0].useSlots();",
  ])("keeps the original diagnostic when an instance or Hook escapes: %s", (source) => {
    expect(
      runRule(rulesOfHooks, classDeclaration + source).diagnostics.map((item) => item.message),
    ).toEqual([expect.stringContaining("`useState` cannot run in a class")]);
  });

  it.each([
    "constructor() { this.useSlots = () => 0; }",
    "constructor() { return { useSlots: () => 0 }; }",
  ])("does not attribute a replaced field to the class initializer: %s", (constructor) => {
    const source =
      classDeclaration.replace(
        "useSlots = () => useState(0);",
        `useSlots = () => useState(0); ${constructor}`,
      ) + "service.useSlots();";
    expect(runRule(rulesOfHooks, source).diagnostics.map((item) => item.message)).toEqual([
      expect.stringContaining("`useState` cannot run in a class"),
    ]);
  });

  it("resolves an imported singleton and keeps normal Hook placement checks", () => {
    const directory = mkdtempSync(join(tmpdir(), "rd-service-hook-field-"));
    try {
      writeFileSync(
        join(directory, "package.json"),
        '{"name":"service-hooks-test","private":true}',
      );
      writeFileSync(
        join(directory, "tsconfig.json"),
        '{"compilerOptions":{"paths":{"@/*":["./*"]}}}',
      );
      writeFileSync(join(directory, "slots.ts"), exportedService);
      writeFileSync(join(directory, "entry.cjs"), "if (require.main === module) console.log(1);");
      const importSource = 'import { service } from "@/slots";';
      const options = { filename: join(directory, "screen.ts") };
      writeFileSync(
        options.filename,
        importSource + "export function Board() { service.useSlots(); return null; }",
      );
      expect(
        runRule(
          rulesOfHooks,
          importSource + "export function Board() { service.useSlots(); return null; }",
          options,
        ).diagnostics,
      ).toEqual([]);
      expect(
        runRule(rulesOfHooks, importSource + "service.useSlots();", options).diagnostics.map(
          (item) => item.message,
        ),
      ).toEqual([expect.stringContaining("`useSlots` can only run inside")]);
      expect(
        runRule(
          rulesOfHooks,
          importSource + "const {useSlots: run} = service; run();",
          options,
        ).diagnostics.map((item) => item.message),
      ).toEqual([expect.stringContaining("`useSlots` can only run inside")]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["export const label: Contract = 1;", false],
    ["export const label = Contract;", true],
  ])("distinguishes declaration-only dependencies from runtime uses: %s", (use, shouldWarn) => {
    const directory = mkdtempSync(join(tmpdir(), "rd-service-hook-types-"));
    try {
      writeFileSync(
        join(directory, "package.json"),
        '{"name":"service-hooks-test","private":true}',
      );
      writeFileSync(join(directory, "slots.ts"), exportedService);
      writeFileSync(join(directory, "contract.d.ts"), "export type Contract = number;");
      writeFileSync(join(directory, "other.ts"), 'import { Contract } from "./contract"; ' + use);
      const result = runRule(rulesOfHooks, exportedService, {
        filename: join(directory, "slots.ts"),
      });
      expect(result.diagnostics).toHaveLength(shouldWarn ? 1 : 0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps the declaration warning when an ignored build output is reachable", () => {
    const directory = mkdtempSync(join(tmpdir(), "rd-service-hook-build-"));
    try {
      writeFileSync(
        join(directory, "package.json"),
        '{"name":"service-hooks-test","private":true}',
      );
      writeFileSync(join(directory, "slots.ts"), exportedService);
      writeFileSync(join(directory, "entry.ts"), 'import "./dist/start.js";');
      mkdirSync(join(directory, "dist"));
      writeFileSync(
        join(directory, "dist/start.js"),
        'import { service } from "../slots"; queueMicrotask(service.useSlots);',
      );
      const result = runRule(rulesOfHooks, exportedService, {
        filename: join(directory, "slots.ts"),
      });
      expect(result.diagnostics.map((item) => item.message)).toEqual([
        expect.stringContaining("`useState` cannot run in a class"),
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["hidden/ignored.ts", "import { service } from '../slots'; service.useSlots();"],
    [
      "screen.ts",
      "import { service } from './slots'; Promise.resolve().then(function Board() { service.useSlots(); });",
    ],
    [
      "screen.ts",
      "import { service } from './slots'; export function Board({ enabled }) { if (!enabled) return null; service.useSlots(); return null; }",
    ],
    [
      "migrations/scheduled.ts",
      "import { service } from '../slots'; const callbacks = [service.useSlots]; callbacks[0]();",
    ],
    [
      "screen.test.ts",
      "import { service } from './slots'; export function choose(key) { service[key](); }",
    ],
    [
      "screen.ts",
      "import * as bindings from './slots'; const callbacks = [bindings.service.useSlots]; callbacks[0]();",
    ],
    ["barrel.ts", "export { service as slots } from './slots';"],
    ["screen.ts", "const slots = await import(('./slots' as string)); slots.service.useSlots();"],
    ["screen.ts", "const load = require; const {service} = load('./slots'); service.useSlots();"],
    [
      "screen.ts",
      "import { createRequire } from 'node:module'; const load = createRequire(import.meta.url); const {service} = load('./slots'); service.useSlots();",
    ],
    [
      "screen.ts",
      "export async function start(key) { const slots = await import(key); slots.service.useSlots(); }",
    ],
    ["screen.ts", "import { service } from './missing-alias'; service.useSlots();"],
  ])("keeps the declaration warning when an incoming route is open: %s", (relative, consumer) => {
    const directory = mkdtempSync(join(tmpdir(), "rd-service-open-field-"));
    try {
      writeFileSync(
        join(directory, "package.json"),
        '{"name":"service-hooks-test","private":true}',
      );
      writeFileSync(join(directory, "slots.ts"), exportedService);
      mkdirSync(dirname(join(directory, relative)), { recursive: true });
      writeFileSync(join(directory, ".gitignore"), "hidden/\n");
      writeFileSync(join(directory, relative), consumer);
      const result = runRule(rulesOfHooks, exportedService, {
        filename: join(directory, "slots.ts"),
      });
      expect(result.diagnostics.map((item) => item.message)).toEqual([
        expect.stringContaining("`useState` cannot run in a class"),
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["<script type=module src=/screen.ts></script>", false],
    ["<script type=module>import { service } from './slots'; service.useSlots();</script>", true],
    [
      "<!-- <script type=module>import './slots';</script> --><script type=application/ld+json>{}</script>",
      false,
    ],
    [
      '<script type="systemjs-importmap">{"imports":{"dep":"https://example.test/lib.js"}}</script>',
      false,
    ],
    ['<script type="importmap">{"imports":{"dep":"./slots.ts"}}</script>', true],
    ['<script type="systemjs-importmap">{"imports":{"dep":"app:display"}}</script>', false],
    [
      '<script type="systemjs-importmap">{"imports":{"dep":"app:display"}}</script><script src="/system.min.js"></script>',
      true,
    ],
    ['<script type="importmap">{"imports":{"dep":"app:display"}}</script>', true],
    [
      '<script type="importmap">{"imports":{"react":"https://example.test/react.js"}}</script>',
      true,
    ],
    ["<script>globalThis.eval('1');</script>", true],
    ["<script>window.System.get('ordinary-module');</script>", true],
    ["<script>document['write']('<p>plain</p>');</script>", true],
    ["<script>const documentAlias = document; documentAlias.createElement('div');</script>", true],
    ["<script>System.import('./slots');</script>", true],
  ])("accounts for executable HTML modules and loader configuration: %s", (html, shouldWarn) => {
    const directory = mkdtempSync(join(tmpdir(), "rd-service-hook-html-"));
    try {
      const filename = join(directory, "slots.ts");
      writeFileSync(
        join(directory, "package.json"),
        '{"name":"service-hooks-test","private":true}',
      );
      writeFileSync(filename, exportedService);
      writeFileSync(
        join(directory, "screen.ts"),
        'import { service } from "./slots"; export function Board() { service.useSlots(); return null; }',
      );
      writeFileSync(join(directory, "index.html"), html);
      const result = runRule(rulesOfHooks, exportedService, { filename });
      expect(result.diagnostics).toHaveLength(shouldWarn ? 1 : 0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
