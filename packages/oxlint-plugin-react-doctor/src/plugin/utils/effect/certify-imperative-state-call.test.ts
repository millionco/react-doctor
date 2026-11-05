import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { buildSourceProjectIndex } from "../build-source-project-index.js";
import { getStaticPropertyName } from "../get-static-property-name.js";
import { isNodeOfType } from "../is-node-of-type.js";
import { normalizeFilename } from "../normalize-filename.js";
import { certifyImperativeStateCall } from "./certify-imperative-state-call.js";

interface ImperativeFixtureOptions {
  readonly method?: string;
  readonly sibling?: string;
  readonly childSetup?: string;
  readonly childReturn?: string;
  readonly parentSetup?: string;
  readonly argument?: string;
  readonly factory?: string;
  readonly refAttribute?: string;
  readonly childHookImport?: string;
  readonly parentHookImport?: string;
  readonly childBinding?: string;
  readonly childTail?: string;
  readonly admitNativeArgument?: boolean;
  readonly hookSource?: string;
  readonly parentReturn?: string;
  readonly childDeclaration?: string;
  readonly selectedMethodName?: string;
  readonly stateInitializer?: string;
}

const certifyFixture = (options: ImperativeFixtureOptions = {}): boolean => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "imperative-source-proof-"));
  const filename = path.join(directory, "screen.tsx");
  const code = `
    import { ${options.parentHookImport ?? "useRef"} } from '${options.hookSource ?? "react"}';
    import { Board } from './board';
    export const Screen = () => {
      const panel = useRef(null);
      ${options.parentSetup ?? ""}
      const run = () => panel.current?.${options.selectedMethodName ?? "commit"}(${options.argument ?? "'tile', true"});
      return ${options.parentReturn ?? `<Board ${options.refAttribute ?? "apiRef={panel}"} />`};
    };
  `;
  fs.writeFileSync(filename, code);
  fs.writeFileSync(
    path.join(directory, "board.tsx"),
    `
    import { ${options.childHookImport ?? "useState, useImperativeHandle"} } from '${options.hookSource ?? "react"}';
    ${options.childDeclaration ?? `export ${options.childBinding ?? "const"} Board = ({ apiRef }) =>`} {
      const [flags, setFlags] = useState(${options.stateInitializer ?? "{}"});
      ${options.childSetup ?? ""}
      useImperativeHandle(apiRef, ${
        options.factory ??
        `() => ({
        commit: ${options.method ?? "(key, value) => setFlags(previous => ({ ...previous, [key]: value }))"},
        ${options.sibling ?? "focus: () => externalFocus()"}
      })`
      }, []);
      return ${options.childReturn ?? "<div />"};
    };
    ${options.childTail ?? ""}
  `,
  );
  try {
    const result = runRule(
      {
        id: "synthetic-imperative-certificate",
        severity: "warn",
        create: (context) => ({
          CallExpression: (node) => {
            if (
              !isNodeOfType(node, "CallExpression") ||
              !isNodeOfType(node.callee, "MemberExpression") ||
              getStaticPropertyName(node.callee) !== (options.selectedMethodName ?? "commit")
            )
              return;
            const program = context.sourceCode?.ast;
            if (!program || !isNodeOfType(program, "Program")) return;
            const projectIndex = buildSourceProjectIndex({
              rootDirectory: directory,
              currentFilePath: normalizeFilename(filename),
              currentProgramNode: program,
              currentScopes: context.scopes,
            });
            if (projectIndex) {
              const currentModule = projectIndex.modulesByFilePath.get(normalizeFilename(filename));
              expect(currentModule?.programNode).toBe(program);
              expect(currentModule?.scopes).toBe(context.scopes);
            }
            if (
              projectIndex &&
              certifyImperativeStateCall(
                node,
                context,
                projectIndex,
                options.admitNativeArgument
                  ? (argument) => isNodeOfType(argument, "MemberExpression")
                  : undefined,
              )
            )
              context.report({ node, message: "certified" });
          },
        }),
      },
      code,
      { filename },
    );
    expect(result.parseErrors).toEqual([]);
    return result.diagnostics.length === 1;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

describe("certifyImperativeStateCall", () => {
  it("certifies a private imported handle and excludes an unrelated focus method", () => {
    expect(certifyFixture()).toBe(true);
  });

  it("certifies a modern named ref prop", () => {
    expect(
      certifyFixture({
        refAttribute: "ref={panel}",
        childDeclaration: "export const Board = ({ ref: apiRef }) =>",
      }),
    ).toBe(true);
  });

  it("certifies a computed own prototype-named method", () => {
    expect(
      certifyFixture({
        selectedMethodName: "__proto__",
        factory:
          "() => ({ ['__proto__']: (key, value) => setFlags(previous => ({ ...previous, [key]: value })) })",
      }),
    ).toBe(true);
  });

  it("allows ordinary render reads outside the eager updater slice", () => {
    expect(certifyFixture({ childReturn: "<div>{flags[foreignKey]}</div>" })).toBe(true);
  });

  it("certifies a singleton child under native host ancestors", () => {
    expect(certifyFixture({ parentReturn: "<section><Board apiRef={panel} /></section>" })).toBe(
      true,
    );
  });

  it("accepts a delegated native primitive argument proof", () => {
    expect(
      certifyFixture({ argument: "candidate.dataset.tile, true", admitNativeArgument: true }),
    ).toBe(true);
  });

  it("certifies primitive local choices and all pure record writers", () => {
    expect(
      certifyFixture({
        argument: "kind, enabled",
        parentSetup: "const kind = 'tile'; const enabled = kind === 'tile' ? true : false;",
        childSetup: "const clear = () => setFlags(previous => ({ ...previous, ['tile']: false }));",
        childReturn: "<div data-active={flags['tile']} />",
      }),
    ).toBe(true);
  });

  it.each([
    [
      "prototype handle property",
      {
        selectedMethodName: "__proto__",
        factory:
          "() => ({ __proto__: (key, value) => setFlags(previous => ({ ...previous, [key]: value })) })",
      },
    ],
    ["parent direct eval escape", { parentSetup: 'eval("publish(panel)");' }],
    ["child direct eval escape", { childSetup: 'eval("publish(apiRef)");' }],
    [
      "child arguments escape",
      {
        childDeclaration: "export function Board({ apiRef })",
        childSetup: "publish(arguments[0]);",
      },
    ],
    ["opaque child wrapper", { parentReturn: "<Opaque><Board apiRef={panel} /></Opaque>" }],
    ["repeated child placement", { parentReturn: "items.map(() => <Board apiRef={panel} />)" }],
    ["compat hooks", { hookSource: "preact/compat" }],
    ["wordpress hooks", { hookSource: "@wordpress/element" }],
    ["replaced imported component", { childBinding: "let", childTail: "Board = foreign;" }],
    ["escaped parent ref", { parentSetup: "publish(panel);" }],
    ["replaced ref current", { parentSetup: "panel.current = replacement;" }],
    ["ambiguous child owners", { refAttribute: "apiRef={panel} otherRef={panel}" }],
    ["spread overrides", { refAttribute: "apiRef={panel} {...extra}" }],
    ["spread argument", { argument: "...candidate.dataset.tile", admitNativeArgument: true }],
    ["unproved argument", { argument: "foreign.key, true" }],
    ["argument coercion", { argument: "'tile', foreign + ''" }],
    ["argument call", { argument: "'tile', readValue()" }],
    [
      "argument getter",
      { argument: "'tile', ({ get value() { publish(); return true; } }).value" },
    ],
    ["setter replacement", { childSetup: "const replace = () => setFlags(external);" }],
    ["setter escape", { childSetup: "publish(setFlags);" }],
    ["state record escape", { childSetup: "publish(flags);" }],
    [
      "state inherited getter mutation",
      { childSetup: "flags['__defineGetter__']('tile', external);" },
    ],
    ["state destructuring mutation", { childSetup: "[flags['tile']] = external;" }],
    ["state loop target mutation", { childSetup: "for (flags['tile'] of external) {}" }],
    ["state record mutation", { childSetup: "flags['tile'] = external;" }],
    [
      "impure updater",
      { method: "(key, value) => setFlags(previous => ({ ...previous, [key]: publish(value) }))" },
    ],
    [
      "updater getter",
      {
        method:
          "(key, value) => setFlags(previous => ({ ...previous, get tile() { return value; } }))",
      },
    ],
    [
      "unproved computed key",
      { method: "(key, value) => setFlags(previous => ({ ...previous, [foreign]: value }))" },
    ],
    [
      "previous record escape",
      { method: "(key, value) => setFlags(previous => ({ ...publish(previous), [key]: value }))" },
    ],
    ["getter handle", { factory: "() => ({ get commit() { return foreign; } })" }],
    [
      "spread handle",
      {
        factory:
          "() => ({ ...foreign, commit: (key, value) => setFlags(previous => ({ ...previous, [key]: value })) })",
      },
    ],
    ["duplicate selected method", { sibling: "commit: () => foreign()" }],
    ["mutable handle receiver", { sibling: "replace: function () { this.commit = foreign; }" }],
    ["handle escape", { sibling: "read: function () { return this; }" }],
    [
      "parent callback",
      {
        method:
          "(key, value) => { apiRef.current.callback(); setFlags(previous => ({ ...previous, [key]: value })); }",
      },
    ],
    [
      "selected focus call",
      {
        method:
          "(key, value) => { foreign.focus(); setFlags(previous => ({ ...previous, [key]: value })); }",
      },
    ],
    [
      "selected event dispatch",
      {
        method:
          "(key, value) => { foreign.dispatchEvent(event); setFlags(previous => ({ ...previous, [key]: value })); }",
      },
    ],
    [
      "selected flush",
      {
        method:
          "(key, value) => flushSync(() => setFlags(previous => ({ ...previous, [key]: value })))",
      },
    ],
    [
      "selected scheduling",
      {
        method:
          "(key, value) => queueMicrotask(() => setFlags(previous => ({ ...previous, [key]: value })))",
      },
    ],
    [
      "async selected method",
      { method: "async (key, value) => setFlags(previous => ({ ...previous, [key]: value }))" },
    ],
    [
      "fake child hook",
      { childHookImport: "useState", childSetup: "const useImperativeHandle = foreign;" },
    ],
  ])("refuses %s", (_name, options) => {
    expect(certifyFixture(options)).toBe(false);
  });

  it.each(["useMemo", "useCallback", "useEffect", "useLayoutEffect"])(
    "certifies a private record retained only in genuine %s dependencies",
    (hookName) => {
      expect(
        certifyFixture({
          childHookImport: `useState, useImperativeHandle, ${hookName}`,
          childSetup: `${hookName}(() => { void flags['tile']; }, [flags]);`,
        }),
      ).toBe(true);
    },
  );

  it.each([
    [
      "renamed React import",
      {
        childHookImport: "useState, useImperativeHandle, useMemo as cacheValue",
        childSetup: "cacheValue(() => flags['tile'], [flags]);",
      },
    ],
    [
      "readonly hook alias",
      {
        childHookImport: "useState, useImperativeHandle, useMemo",
        childSetup: "const cacheValue = useMemo; cacheValue(() => flags['tile'], [flags]);",
      },
    ],
    [
      "readonly namespace hook",
      {
        childSetup: "React.useMemo(() => flags['tile'], [flags]);",
        childTail: "import * as React from 'react';",
      },
    ],
    [
      "transparent dependency array",
      {
        childHookImport: "useState, useImperativeHandle, useMemo",
        childSetup: "useMemo(() => flags['tile'], ([flags] as const));",
      },
    ],
    [
      "multiple ordinary identity dependencies",
      {
        childHookImport: "useState, useImperativeHandle, useMemo",
        childSetup: "const revision = 1; useMemo(() => flags['tile'], [revision, flags]);",
      },
    ],
  ])("certifies %s without widening record writers", (_name, options) => {
    expect(certifyFixture(options)).toBe(true);
  });

  it.each([
    [
      "aliased dependency array",
      { childSetup: "const dependencies = [flags]; useMemo(() => null, dependencies);" },
    ],
    [
      "escaped dependency array",
      {
        childSetup:
          "const dependencies = [flags]; publish(dependencies); useMemo(() => null, dependencies);",
      },
    ],
    ["wrong dependency argument", { childSetup: "useMemo([flags], []);" }],
    ["nested dependency array", { childSetup: "useMemo(() => null, [[flags]]);" }],
    ["spread record dependency", { childSetup: "useMemo(() => null, [...flags]);" }],
    ["spread sibling dependency", { childSetup: "useMemo(() => null, [flags, ...foreign]);" }],
    ["dependency hole", { childSetup: "useMemo(() => null, [, flags]);" }],
    ["extra hook argument", { childSetup: "useMemo(() => null, [flags], foreign);" }],
    ["spread callback argument", { childSetup: "useMemo(...foreign, [flags]);" }],
    ["optional hook call", { childSetup: "useMemo?.(() => null, [flags]);" }],
    [
      "optional namespace hook",
      {
        childSetup: "React?.useMemo(() => null, [flags]);",
        childTail: "import * as React from 'react';",
      },
    ],
    [
      "custom hook dependency",
      { childSetup: "const useCustom = foreign; useCustom(() => null, [flags]);" },
    ],
    [
      "foreign hook import",
      {
        childHookImport: "useState, useImperativeHandle",
        childSetup: "useMemo(() => null, [flags]);",
        childTail: "import { useMemo } from 'foreign-hooks';",
      },
    ],
    ["shadowed hook", { childSetup: "const useMemo = foreign; useMemo(() => null, [flags]);" }],
    [
      "unbound hook name",
      {
        childHookImport: "useState, useImperativeHandle",
        childSetup: "useMemo(() => null, [flags]);",
      },
    ],
    [
      "type-only hook import is no runtime provider",
      {
        childHookImport: "useState, useImperativeHandle, type useMemo",
        childSetup: "useMemo(() => null, [flags]);",
      },
    ],
    [
      "type-only React namespace is no runtime provider",
      {
        childSetup: "React.useMemo(() => flags['tile'], [flags]);",
        childTail: "import type * as React from 'react';",
      },
    ],
    [
      "reassigned imported hook in parser-only input",
      { childSetup: "useMemo = foreign; useMemo(() => null, [flags]);" },
    ],
    [
      "mutable hook alias",
      {
        childSetup:
          "let cacheValue = useMemo; cacheValue = foreign; cacheValue(() => null, [flags]);",
      },
    ],
    [
      "nested uncertain hook placement",
      { childSetup: "const derive = () => useMemo(() => flags['tile'], [flags]);" },
    ],
    ["callback returns whole record", { childSetup: "useMemo(() => flags, [flags]);" }],
    ["callback passes whole record", { childSetup: "useMemo(() => publish(flags), [flags]);" }],
    [
      "state alias still escapes",
      { childSetup: "const alias = flags; useMemo(() => alias['tile'], [flags]);" },
    ],
    [
      "state property mutation remains unsafe",
      { childSetup: "flags['tile'] = false; useMemo(() => flags['tile'], [flags]);" },
    ],
    [
      "unknown other state writer",
      {
        childSetup:
          "const replace = () => setFlags(foreign); useMemo(() => flags['tile'], [flags]);",
      },
    ],
    [
      "accessor other state writer",
      {
        childSetup:
          "const replace = () => setFlags(previous => ({ ...previous, get tile() { return foreign(); } })); useMemo(() => flags['tile'], [flags]);",
      },
    ],
    [
      "Proxy other state writer",
      {
        childSetup:
          "const replace = () => setFlags(new Proxy({}, {})); useMemo(() => flags['tile'], [flags]);",
      },
    ],
    [
      "accessor state initializer",
      {
        stateInitializer: "({ get tile() { return foreign(); } })",
        childSetup: "useMemo(() => flags['tile'], [flags]);",
      },
    ],
    [
      "Proxy state initializer",
      {
        stateInitializer: "new Proxy({}, {})",
        childSetup: "useMemo(() => flags['tile'], [flags]);",
      },
    ],
    [
      "async imperative method",
      {
        method: "async (key, value) => setFlags(previous => ({ ...previous, [key]: value }))",
        childSetup: "useMemo(() => flags['tile'], [flags]);",
      },
    ],
    [
      "async state updater",
      {
        method: "(key, value) => setFlags(async previous => ({ ...previous, [key]: value }))",
        childSetup: "useMemo(() => flags['tile'], [flags]);",
      },
    ],
    [
      "selected parent callback",
      {
        method:
          "(key, value) => { notify(); setFlags(previous => ({ ...previous, [key]: value })); }",
        childSetup: "useMemo(() => flags['tile'], [flags]);",
      },
    ],
    [
      "imperative-handle third argument",
      { childSetup: "useImperativeHandle(foreign, () => ({}), [flags]);" },
    ],
  ])("refuses %s despite identity-only dependency support", (_name, options) => {
    expect(
      certifyFixture({
        childHookImport: "useState, useImperativeHandle, useMemo",
        ...options,
      }),
    ).toBe(false);
  });
});
