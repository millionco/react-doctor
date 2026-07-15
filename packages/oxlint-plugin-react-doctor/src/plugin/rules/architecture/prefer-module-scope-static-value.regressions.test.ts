import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preferModuleScopeStaticValue } from "./prefer-module-scope-static-value.js";

const run = (code: string) =>
  runRule(preferModuleScopeStaticValue, code, { filename: "fixture.tsx" });

describe("architecture/prefer-module-scope-static-value — regressions", () => {
  it("does not flag an object initializer that calls Date.now()", () => {
    const result = run(
      `function Banner() { const meta = { renderedAt: Date.now() }; return <span>{meta.renderedAt}</span>; }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag an array initializer built from Math.random()", () => {
    const result = run(
      `function Sparkles() { const seeds = [Math.random(), Math.random()]; return <div>{seeds.join()}</div>; }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag an object built from crypto.randomUUID()", () => {
    const result = run(
      `function Row() { const id = { value: crypto.randomUUID() }; return <li>{id.value}</li>; }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag an object built from globalThis.crypto.randomUUID()", () => {
    const result = run(
      `function Row() { const id = { value: globalThis.crypto.randomUUID() }; return <li>{id.value}</li>; }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it.each(["window", "self"])(
    "does not flag an object built from %s.crypto.randomUUID()",
    (globalObjectName) => {
      const result = run(
        `function Row() { const id = { value: ${globalObjectName}.crypto.randomUUID() }; return <li>{id.value}</li>; }`,
      );
      expect(result.diagnostics).toEqual([]);
    },
  );

  it.each([
    [
      "a namespace import from node:crypto",
      'import * as nodeCrypto from "node:crypto";',
      "nodeCrypto.randomUUID()",
    ],
    [
      "a default import from crypto",
      'import nodeCrypto from "crypto";',
      "nodeCrypto.randomBytes(16)",
    ],
    [
      "a const alias of a node:crypto import",
      'import * as nodeCrypto from "node:crypto"; const runtimeCrypto = nodeCrypto;',
      "runtimeCrypto.randomUUID()",
    ],
    [
      "a node:crypto require",
      'const nodeCrypto = require("node:crypto");',
      "nodeCrypto.randomUUID()",
    ],
    ["a crypto require", 'const nodeCrypto = require("crypto");', "nodeCrypto.randomBytes(16)"],
    [
      "an asserted node:crypto require",
      'const nodeCrypto = require("node:crypto") as typeof import("node:crypto");',
      "nodeCrypto.randomUUID()",
    ],
    [
      "a parenthesized non-null crypto require",
      'const nodeCrypto = (require("crypto")!);',
      "nodeCrypto.randomBytes(16)",
    ],
    [
      "transitive const aliases of a crypto require",
      'const nodeCrypto = require("crypto"); const cryptoAlias = nodeCrypto; const runtimeCrypto = cryptoAlias;',
      "runtimeCrypto.randomBytes(16)",
    ],
  ])("does not flag an object built from %s", (_label, setup, expression) => {
    const result = run(
      `${setup} function Row() { const id = { value: ${expression} }; return <li>{String(id.value)}</li>; }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [
      "a shadowed globalThis",
      'const globalThis = { crypto: { randomUUID: () => "fixed" } };',
      "globalThis.crypto.randomUUID()",
    ],
    [
      "a shadowed direct namespace",
      'const crypto = { randomUUID: () => "fixed" };',
      "crypto.randomUUID()",
    ],
    [
      "a userland receiver chain",
      'const runtime = { crypto: { randomUUID: () => "fixed" } };',
      "runtime.crypto.randomUUID()",
    ],
    [
      "a const alias of a userland crypto lookalike",
      'const localCrypto = { randomUUID: () => "fixed" }; const runtimeCrypto = localCrypto;',
      "runtimeCrypto.randomUUID()",
    ],
    [
      "a mutable alias of a node:crypto import",
      'import * as nodeCrypto from "node:crypto"; let runtimeCrypto = nodeCrypto;',
      "runtimeCrypto.randomUUID()",
    ],
    [
      "a mutable alias of a crypto require",
      'const nodeCrypto = require("crypto"); let runtimeCrypto = nodeCrypto;',
      "runtimeCrypto.randomBytes(16)",
    ],
    [
      "cyclic const aliases",
      "const firstCrypto = secondCrypto; const secondCrypto = firstCrypto;",
      "firstCrypto.randomUUID()",
    ],
    [
      "an imported userland crypto lookalike",
      'import * as nodeCrypto from "custom-crypto";',
      "nodeCrypto.randomUUID()",
    ],
    [
      "a required userland crypto lookalike",
      'const nodeCrypto = require("custom-crypto");',
      "nodeCrypto.randomBytes(16)",
    ],
    [
      "an asserted userland crypto lookalike",
      'const nodeCrypto = require("custom-crypto") as CryptoLike;',
      "nodeCrypto.randomBytes(16)",
    ],
    [
      "a dynamic namespace member",
      'const namespaceName = "crypto";',
      "globalThis[namespaceName].randomUUID()",
    ],
    [
      "a dynamic method member",
      'const methodName = "randomUUID";',
      "globalThis.crypto[methodName]()",
    ],
  ])("still flags a pure object built from %s", (_label, setup, expression) => {
    const result = run(
      `${setup} function Row() { const id = { value: ${expression} }; return <li>{id.value}</li>; }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag an array built from nanoid() (impure id generator)", () => {
    const result = run(
      `import { nanoid } from "nanoid"; function Row() { const ids = [nanoid(), nanoid()]; return <div>{ids.join()}</div>; }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a pure literal array with no impure call", () => {
    const result = run(
      `function List() { const items = [1, 2, 3]; return <div>{items.join()}</div>; }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag the geist-ui shape: static array consumed only by .includes", () => {
    const result = run(`
      import React from "react";
      import { ScalePropKeys } from "./scale-context";
      const withScale = (Render) => {
        const ScaleFC = React.forwardRef((props, ref) => {
          const allScalePropKeys = [...ScalePropKeys, "scale", "unit"];
          const filtered = Object.fromEntries(
            Object.entries(props).filter(([key]) => !allScalePropKeys.includes(key)),
          );
          return <Render ref={ref} {...filtered} />;
        });
        return ScaleFC;
      };
      export default withScale;
    `);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a tiny literal array fed only to .includes", () => {
    const result = run(`
      function Toolbar({ kind }) {
        const hiddenKinds = ["draft", "archived"];
        if (hiddenKinds.includes(kind)) return null;
        return <div>{kind}</div>;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  // cloudscape link/internal.tsx: `.indexOf(x) > -1` membership test —
  // same scalar-lookup shape as `.includes`, the value never escapes.
  it("does not flag a static array consumed only by .indexOf (cloudscape corpus shape)", () => {
    const result = run(`
      import React from "react";
      const InternalLink = React.forwardRef(({ variant }, ref) => {
        const specialStyles = ["top-navigation", "link", "recovery"];
        const hasSpecialStyle = specialStyles.indexOf(variant) > -1;
        return <a ref={ref} data-special={hasSpecialStyle} />;
      });
      export default InternalLink;
    `);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // evo-web menu-item.tsx: typed static array read only via .includes.
  it("does not flag a typed static array consumed only by .includes (evo-web corpus shape)", () => {
    const result = run(`
      const EbayMenuItem = ({ type, children }) => {
        const checkable: EbayMenuType[] = ["radio", "checkbox"];
        const role = checkable.includes(type) ? \`menuitem\${type}\` : "menuitem";
        return <div role={role}>{children}</div>;
      };
    `);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a static array consumed via .map into JSX", () => {
    const result = run(`
      function Tabs() {
        const tabNames = ["home", "settings"];
        return <div>{tabNames.map((tabName) => <span key={tabName}>{tabName}</span>)}</div>;
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a static array passed as a JSX prop even when also used by .includes", () => {
    const result = run(`
      function Filters({ active }) {
        const filterKinds = ["all", "done"];
        const isActive = filterKinds.includes(active);
        return <FilterList kinds={filterKinds} highlighted={isActive} />;
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a static array listed in a hook dependency array", () => {
    const result = run(`
      import { useEffect } from "react";
      function Sync() {
        const channels = ["email", "sms"];
        useEffect(() => { subscribe(channels); }, [channels]);
        return null;
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a static object that is returned from a hook", () => {
    const result = run(`
      function useDefaults() {
        const defaults = { pageSize: 10, sort: "asc" };
        return defaults;
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not prescribe hoisting a nested array accumulator mutated in a callback", () => {
    const result = run(`
      const Tweets = [{ showOnHomepage: true }];
      function TweetsSection() {
        const tweetColumns = [[], [], []];
        Tweets.filter((tweet) => tweet.showOnHomepage).forEach((tweet, index) =>
          tweetColumns[index % 3]!.push(tweet),
        );
        return <div>{tweetColumns.map((column) => column.length)}</div>;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags the same nested array when it remains read-only", () => {
    const result = run(`
      function TweetsSection() {
        const tweetColumns = [[], [], []];
        return <Grid columns={tweetColumns} />;
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    "matrix[0]!.push(1)",
    "matrix[0]?.push(1)",
    "(matrix[0] as number[]).push(1)",
    "matrix['0']['push'](1)",
    "matrix[0]!.sort()",
    "(matrix.push as (value: number[]) => number)([])",
    "(matrix[0]!.push as (value: number) => number)(1)",
    "((matrix['push'] as (value: number[]) => number))([])",
  ])("recognizes a nested receiver mutation through %s", (mutation) => {
    const result = run(`
      function Matrix() {
        const matrix = [[], []];
        ${mutation};
        return <Grid matrix={matrix} />;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "state.nested.count += 1",
    "state.nested.count++",
    "delete state.nested.count",
    "state['nested']['count'] = 1",
  ])("recognizes a nested property mutation through %s", (mutation) => {
    const result = run(`
      function Counter() {
        const state = { nested: { count: 0 } };
        ${mutation};
        return <Output value={state} />;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "matrix.map((row) => row).push([])",
    "matrix.slice().reverse()",
    "(matrix.slice().push as (value: number[]) => number)([])",
  ])("still reports when only a derived array is mutated through %s", (mutation) => {
    const result = run(`
        function Matrix() {
          const matrix = [[], []];
          ${mutation};
          return <Grid matrix={matrix} />;
        }
      `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a static array built from a pure module-scope helper named `random`", () => {
    const result = run(`
      const random = (seed) => (seed * 9301 + 49297) % 233280;
      function List() {
        const weights = [random(1), random(2)];
        return <div>{weights.join()}</div>;
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a static array built from a deterministic module-scope `generateId` helper", () => {
    const result = run(`
      function Columns() {
        const columns = [{ id: generateId("name") }, { id: generateId("age") }];
        return <div>{columns.length}</div>;
      }
      const generateId = (label) => "col-" + label;
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag an array built from an imported generateId helper", () => {
    const result = run(`
      import { generateId } from "./ids";
      function Columns() {
        const columns = [{ id: generateId("name") }, { id: generateId("age") }];
        return <div>{columns.length}</div>;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag an array built from a bare unresolved randomUUID()", () => {
    const result = run(
      `function Row() { const ids = [randomUUID(), randomUUID()]; return <div>{ids.join()}</div>; }`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
