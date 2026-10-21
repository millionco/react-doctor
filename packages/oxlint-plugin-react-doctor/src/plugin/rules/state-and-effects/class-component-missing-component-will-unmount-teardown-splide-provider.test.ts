import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { resetManifestCaches } from "../../utils/read-nearest-package-manifest.js";
import { wrapWithSemanticContext } from "../../utils/wrap-with-semantic-context.js";
import { classComponentMissingComponentWillUnmountTeardown } from "./class-component-missing-component-will-unmount-teardown.js";

const SOURCE = `import React from "react";
import { Splide as Deck } from "@splidejs/splide";
import { subscriptions } from "./event-list";
export class GalleryView extends React.Component {
  deck: Deck | undefined;
  componentDidMount() {
    this.deck = new Deck("#gallery");
    this.listen(this.deck);
    this.deck.mount();
  }
  listen(owner: Deck) {
    subscriptions.forEach(([eventName, callbackName]) => {
      const callback = this.props[callbackName];
      if (typeof callback === "function") owner.on(eventName, (...values) => callback(...values));
    });
  }
  componentWillUnmount() {
    if (this.deck) {
      this.deck.destroy();
      this.deck = undefined;
    }
  }
  render() { return null; }
}`;
const PROVIDER =
  'export const subscriptions = [["ready", "onReady"], ["move", "onMove"]] as const;';
let temporaryDirectory: string;
beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-splide-provider-"));
  resetManifestCaches();
});
afterEach(() => {
  resetManifestCaches();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe.each([
  { mode: "direct", rule: classComponentMissingComponentWillUnmountTeardown },
  {
    mode: "semantic wrapper",
    rule: wrapWithSemanticContext(classComponentMissingComponentWillUnmountTeardown),
  },
])("closed Splide event providers ($mode)", ({ rule }) => {
  it.each([
    { name: "native literal vector", provider: PROVIDER, expected: 0 },
    {
      name: "erased provider interface",
      provider: `${PROVIDER}\ninterface Metadata { Function: string; module: unknown; }`,
      expected: 0,
    },
    {
      name: "deferred custom forEach",
      provider:
        'export const subscriptions = { forEach(callback) { queueMicrotask(() => callback(["ready", "onReady"])); } };',
      expected: 1,
    },
    {
      name: "native forEach replacement",
      provider: `${PROVIDER}\nsubscriptions.forEach = callback => queueMicrotask(() => callback(["ready", "onReady"]));`,
      expected: 1,
    },
    { name: "mutable event binding", provider: PROVIDER.replace("const", "let"), expected: 1 },
    {
      name: "escaped native vector",
      provider: `${PROVIDER}\nconst escaped = subscriptions;`,
      expected: 1,
    },
    {
      name: "getter-based vector",
      provider:
        'export const subscriptions = { get forEach() { return callback => callback(["ready", "onReady"]); } };',
      expected: 1,
    },
  ])("handles $name", ({ provider, expected }) => {
    fs.writeFileSync(path.join(temporaryDirectory, "event-list.ts"), provider);
    const result = runRule(rule, SOURCE, {
      filename: path.join(temporaryDirectory, "GalleryView.tsx"),
      forceJsx: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });

  it.each([
    {
      name: "destructured Object prototype authority",
      prefix:
        'const { getPrototypeOf: get } = Object; get([]).forEach = callback => queueMicrotask(() => callback(["ready", "onReady"]));',
      expected: 1,
    },
    {
      name: "erased destructured Object prototype authority",
      prefix:
        'interface Object { text?: string; } const { getPrototypeOf: get } = Object; get([]).forEach = callback => queueMicrotask(() => callback(["ready", "onReady"]));',
      expected: 1,
    },
    {
      name: "aliased Object prototype authority",
      prefix:
        'const tools = Object; tools.getPrototypeOf([]).forEach = callback => queueMicrotask(() => callback(["ready", "onReady"]));',
      expected: 1,
    },
    {
      name: "erased aliased Object prototype authority",
      prefix:
        'interface Object { text?: string; } const tools = Object; tools.getPrototypeOf([]).forEach = callback => queueMicrotask(() => callback(["ready", "onReady"]));',
      expected: 1,
    },
    {
      name: "destructured Reflect prototype authority",
      prefix:
        'const { getPrototypeOf: get } = Reflect; get([]).forEach = callback => queueMicrotask(() => callback(["ready", "onReady"]));',
      expected: 1,
    },
    {
      name: "erased destructured Reflect prototype authority",
      prefix:
        'interface Reflect { text?: string; } const { getPrototypeOf: get } = Reflect; get([]).forEach = callback => queueMicrotask(() => callback(["ready", "onReady"]));',
      expected: 1,
    },
    {
      name: "aliased Reflect prototype authority",
      prefix:
        'const tools = Reflect; tools.getPrototypeOf([]).forEach = callback => queueMicrotask(() => callback(["ready", "onReady"]));',
      expected: 1,
    },
    {
      name: "erased aliased Reflect prototype authority",
      prefix:
        'interface Reflect { text?: string; } const tools = Reflect; tools.getPrototypeOf([]).forEach = callback => queueMicrotask(() => callback(["ready", "onReady"]));',
      expected: 1,
    },
    {
      name: "inert intrinsic keys and ordinary Object keys",
      prefix: "const names = { Object: 1, Reflect: 2 }; const keys = Object.keys(names);",
      expected: 0,
    },
    {
      name: "unused intrinsic-like value bindings",
      prefix: "const Object = 1; const Reflect = 2;",
      expected: 0,
    },
  ])("handles $name", ({ prefix, expected }) => {
    fs.writeFileSync(path.join(temporaryDirectory, "event-list.ts"), PROVIDER);
    const result = runRule(rule, `${prefix}\n${SOURCE}`, {
      filename: path.join(temporaryDirectory, "GalleryView.tsx"),
      forceJsx: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });

  it("declines a visible owner escape through the otherwise native provider", () => {
    fs.writeFileSync(path.join(temporaryDirectory, "event-list.ts"), PROVIDER);
    const result = runRule(
      rule,
      SOURCE.replace("callback(...values)", "callback(owner, ...values)"),
      { filename: path.join(temporaryDirectory, "GalleryView.tsx"), forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps ownership validation local when multiple classes share one native constructor", () => {
    fs.writeFileSync(path.join(temporaryDirectory, "event-list.ts"), PROVIDER);
    const classOffset = SOURCE.indexOf("export class");
    const otherClass = SOURCE.slice(classOffset)
      .replace("GalleryView", "OtherGalleryView")
      .replace("callback(...values)", "callback(owner, ...values)");
    const result = runRule(rule, `${SOURCE}\n${otherClass}`, {
      filename: path.join(temporaryDirectory, "GalleryView.tsx"),
      forceJsx: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
