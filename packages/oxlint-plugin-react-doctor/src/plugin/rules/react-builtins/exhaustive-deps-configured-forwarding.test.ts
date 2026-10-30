import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RuleDiagnostic } from "../../../test-utils/run-rule.js";
import { exhaustiveDeps } from "./exhaustive-deps.js";
import type { ReportDescriptor } from "../../utils/report-descriptor.js";
import { getNodeStartIndex } from "../../utils/get-node-start-index.js";
import { getNodeEndIndex } from "../../utils/get-node-end-index.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { attachSourceLocations } from "../../../test-utils/attach-source-locations.js";
import { wrapWithSemanticContext } from "../../utils/wrap-with-semantic-context.js";
import { walkAst } from "../../utils/walk-ast.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

interface ForwardingFixtureOptions {
  readonly wrapper?: string;
  readonly caller?: string;
  readonly prelude?: string;
  readonly provider?: string;
}

const runForwardingFixture = ({
  wrapper = "const useScopedEffect = (callback, dependencies) => useEffect(callback, dependencies);",
  caller = "useScopedEffect(() => console.info(token), []);",
  prelude = "",
  provider = 'import { useEffect } from "react";',
}: ForwardingFixtureOptions = {}) =>
  runRule(
    exhaustiveDeps,
    `${provider}
${prelude}
${wrapper}
const Panel = ({ token, dependencies, callback }) => {
  ${caller}
  return null;
};`,
    {
      settings: { "react-doctor": { exhaustiveDeps: { additionalHooks: "^useScopedEffect$" } } },
      includeLocations: true,
    },
  );

describe("configured callback forwarding", () => {
  it.each([
    {
      name: "configured complete dependencies",
      additionalHooks: "^useScopedEffect$",
      code: `
import { useEffect } from "react";
const useScopedEffect = (callback, dependencies) => useEffect(callback, dependencies);
const Panel = ({ token }) => {
  useScopedEffect(() => console.info(token), [token]);
  return null;
};`,
      expectedMessages: [],
    },
    {
      name: "configured missing capture",
      additionalHooks: "^useScopedEffect$",
      code: `
import { useEffect } from "react";
const useScopedEffect = (callback, dependencies) => useEffect(callback, dependencies);
const Panel = ({ token }) => {
  useScopedEffect(() => console.info(token), []);
  return null;
};`,
      expectedMessages: [
        "`useScopedEffect` can run with a stale `token` & show your users old data.",
      ],
    },
    {
      name: "unconfigured missing capture retains opacity",
      additionalHooks: "",
      code: `
import { useEffect } from "react";
const useScopedEffect = (callback, dependencies) => useEffect(callback, dependencies);
const Panel = ({ token }) => {
  useScopedEffect(() => console.info(token), []);
  return null;
};`,
      expectedMessages: [
        "`useEffect`'s callback is defined elsewhere, so dependencies can't be checked and stale values can slip through.",
      ],
    },
    {
      name: "invalid configuration retains opacity",
      additionalHooks: "[",
      code: `
import { useEffect } from "react";
const useScopedEffect = (callback, dependencies) => useEffect(callback, dependencies);
const Panel = ({ token }) => {
  useScopedEffect(() => console.info(token), []);
  return null;
};`,
      expectedMessages: [
        "`useEffect`'s callback is defined elsewhere, so dependencies can't be checked and stale values can slip through.",
      ],
    },
    {
      name: "nonmatching configuration retains opacity",
      additionalHooks: "^useOtherEffect$",
      code: `
import { useEffect } from "react";
const useScopedEffect = (callback, dependencies) => useEffect(callback, dependencies);
const Panel = ({ token }) => {
  useScopedEffect(() => console.info(token), []);
  return null;
};`,
      expectedMessages: [
        "`useEffect`'s callback is defined elsewhere, so dependencies can't be checked and stale values can slip through.",
      ],
    },
    {
      name: "configured two callers retain missing capture",
      additionalHooks: "^useScopedEffect$",
      code: `
import { useEffect } from "react";
const useScopedEffect = (callback, dependencies) => useEffect(callback, dependencies);
const Panel = ({ token, other }) => {
  useScopedEffect(() => console.info(token), [token]);
  useScopedEffect(() => console.info(other), []);
  return null;
};`,
      expectedMessages: [
        "`useScopedEffect` can run with a stale `other` & show your users old data.",
      ],
    },
    {
      name: "configured duplicate dependencies remain checked",
      additionalHooks: "^useScopedEffect$",
      code: `
import { useEffect } from "react";
const useScopedEffect = (callback, dependencies) => useEffect(callback, dependencies);
const Panel = ({ token }) => {
  useScopedEffect(() => console.info(token), [token, token]);
  return null;
};`,
      expectedMessages: [
        "`useScopedEffect` lists `token` twice, adding dependency-array noise without changing when it runs.",
      ],
    },
    {
      name: "configured dependency parameter bypasses caller comparison",
      additionalHooks: "^useScopedEffect$",
      code: `
import { useEffect } from "react";
const useScopedEffect = (callback, dependencies) => useEffect(callback, dependencies);
const Panel = ({ token, dependencies }) => {
  useScopedEffect(() => console.info(token), dependencies);
  return null;
};`,
      expectedMessages: [
        "`useEffect`'s callback is defined elsewhere, so dependencies can't be checked and stale values can slip through.",
      ],
    },
    {
      name: "configured literal nonarray remains checked",
      additionalHooks: "^useScopedEffect$",
      code: `
import { useEffect } from "react";
const useScopedEffect = (callback, dependencies) => useEffect(callback, dependencies);
const Panel = ({ token }) => {
  useScopedEffect(() => console.info(token), null);
  return null;
};`,
      expectedMessages: [
        "`useEffect`'s callback is defined elsewhere, so dependencies can't be checked and stale values can slip through.",
        "`useScopedEffect`'s dependencies can't be checked because its second argument isn't an inline array, so stale values can slip through.",
        "`useScopedEffect` can run with a stale `token` & show your users old data.",
      ],
    },
    {
      name: "ordinary React effect retains missing capture",
      additionalHooks: "",
      code: `
import { useEffect } from "react";
const Panel = ({ token }) => {
  useEffect(() => console.info(token), []);
  return null;
};`,
      expectedMessages: ["`useEffect` can run with a stale `token` & show your users old data."],
    },
  ])("$name", ({ additionalHooks, code, expectedMessages }) => {
    const result = runRule(exhaustiveDeps, code, {
      settings: { "react-doctor": { exhaustiveDeps: { additionalHooks } } },
      includeLocations: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(expectedMessages);
  });

  it.each([
    [
      "block return",
      "const useScopedEffect = (callback, dependencies) => { return useEffect(callback, dependencies); };",
    ],
    [
      "block expression",
      "const useScopedEffect = (callback, dependencies) => { useEffect(callback, dependencies); };",
    ],
  ])("checks callers for %s forwarding", (_name, wrapper) => {
    const result = runForwardingFixture({ wrapper });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      "`useScopedEffect` can run with a stale `token` & show your users old data.",
    ]);
  });

  it.each([
    [
      "exported declaration",
      {
        wrapper:
          "export const useScopedEffect = (callback, dependencies) => useEffect(callback, dependencies);",
      },
    ],
    ["named export", { prelude: "export { useScopedEffect };" }],
    ["default export", { prelude: "export default useScopedEffect;" }],
    ["alias", { prelude: "const alias = useScopedEffect;" }],
    ["escaped wrapper", { prelude: "consume(useScopedEffect);" }],
    ["wrapper write", { prelude: "useScopedEffect = replacement;" }],
    [
      "mutable wrapper",
      {
        wrapper:
          "let useScopedEffect = (callback, dependencies) => useEffect(callback, dependencies);",
      },
    ],
    [
      "function declaration",
      {
        wrapper:
          "function useScopedEffect(callback, dependencies) { return useEffect(callback, dependencies); }",
      },
    ],
    [
      "async wrapper",
      {
        wrapper:
          "const useScopedEffect = async (callback, dependencies) => useEffect(callback, dependencies);",
      },
    ],
    [
      "default formal",
      {
        wrapper:
          "const useScopedEffect = (callback, dependencies = []) => useEffect(callback, dependencies);",
      },
    ],
    [
      "destructured formal",
      {
        wrapper:
          "const useScopedEffect = ({ callback }, dependencies) => useEffect(callback, dependencies);",
      },
    ],
    [
      "rest formal",
      {
        wrapper:
          "const useScopedEffect = (callback, ...dependencies) => useEffect(callback, dependencies);",
      },
    ],
    [
      "extra formal",
      {
        wrapper:
          "const useScopedEffect = (callback, dependencies, extra) => useEffect(callback, dependencies);",
      },
    ],
    [
      "extra work",
      {
        wrapper:
          "const useScopedEffect = (callback, dependencies) => { consume(token); return useEffect(callback, dependencies); };",
      },
    ],
    [
      "branch",
      {
        wrapper:
          "const useScopedEffect = (callback, dependencies) => enabled ? useEffect(callback, dependencies) : useEffect(callback, dependencies);",
      },
    ],
    [
      "extra effect argument",
      {
        wrapper:
          "const useScopedEffect = (callback, dependencies) => useEffect(callback, dependencies, extra);",
      },
    ],
    [
      "callback transform",
      {
        wrapper:
          "const useScopedEffect = (callback, dependencies) => useEffect(wrap(callback), dependencies);",
      },
    ],
    [
      "dependency transform",
      {
        wrapper:
          "const useScopedEffect = (callback, dependencies) => useEffect(callback, [...dependencies]);",
      },
    ],
    ["optional caller", { caller: "useScopedEffect?.(() => console.info(token), []);" }],
    ["call transport", { caller: "useScopedEffect.call(null, () => console.info(token), []);" }],
    ["extra caller argument", { caller: "useScopedEffect(() => console.info(token), [], extra);" }],
    ["spread caller argument", { caller: "useScopedEffect(...[() => console.info(token), []]);" }],
    ["unknown caller callback", { caller: "useScopedEffect(callback, []);" }],
    [
      "generator caller callback",
      { caller: "useScopedEffect(function* () { console.info(token); }, []);" },
    ],
    ["async caller callback", { caller: "useScopedEffect(async () => console.info(token), []);" }],
    ["absent caller deps", { caller: "useScopedEffect(() => console.info(token));" }],
    ["undefined caller deps", { caller: "useScopedEffect(() => console.info(token), undefined);" }],
    [
      "outer assignment early return",
      { caller: "let stored; useScopedEffect(() => { stored = token; }, []);" },
    ],
    ["direct eval", { prelude: "eval('useScopedEffect');" }],
    [
      "erased eval binding",
      { prelude: "declare const eval: (input: string) => unknown; eval('useScopedEffect');" },
    ],
    [
      "lexical receiver",
      {
        wrapper:
          "const useScopedEffect = (callback, dependencies) => useEffect(callback, this.dependencies);",
      },
    ],
    [
      "import alias",
      {
        provider: 'import { useEffect as selectedEffect } from "react";',
        wrapper:
          "const useScopedEffect = (callback, dependencies) => selectedEffect(callback, dependencies);",
      },
    ],
    [
      "local provider alias",
      {
        prelude: "const selectedEffect = useEffect;",
        wrapper:
          "const useScopedEffect = (callback, dependencies) => selectedEffect(callback, dependencies);",
      },
    ],
    [
      "namespace provider",
      {
        provider: 'import * as React from "react";',
        wrapper:
          "const useScopedEffect = (callback, dependencies) => React.useEffect(callback, dependencies);",
      },
    ],
    ["unbound provider", { provider: "export {};" }],
    ["type-only provider", { provider: 'import type { useEffect } from "react";' }],
    ["written provider", { prelude: "useEffect = replacement;" }],
    ["unused wrapper", { caller: "console.info(token);" }],
  ])("retains inner opacity for %s", (_name, options: ForwardingFixtureOptions) => {
    const result = runForwardingFixture(options);
    expect(result.parseErrors).toEqual([]);
    expect(
      result.diagnostics.some((diagnostic) =>
        diagnostic.message.includes("callback is defined elsewhere"),
      ),
    ).toBe(true);
  });

  it("keeps ordinary caller descriptor identity and relative order", () => {
    const code = `import { useEffect } from "react";
const useScopedEffect = (callback, dependencies) => useEffect(callback, dependencies);
const Panel = ({ first, second }) => {
  useScopedEffect(() => console.info(first), []);
  useScopedEffect(() => console.info(second), []);
};`;
    const descriptors: ReportDescriptor[] = [];
    const result = runRule(
      {
        ...exhaustiveDeps,
        create: (context) =>
          exhaustiveDeps.create(
            new Proxy(context, {
              get: (target, property) =>
                property === "report"
                  ? (descriptor: ReportDescriptor) => {
                      descriptors.push(descriptor);
                      target.report(descriptor);
                    }
                  : Reflect.get(target, property, target),
            }),
          ),
      },
      code,
      {
        settings: { "react-doctor": { exhaustiveDeps: { additionalHooks: "^useScopedEffect$" } } },
        includeLocations: true,
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([
      {
        line: 4,
        column: 45,
        nodeType: "ArrayExpression",
        message: "`useScopedEffect` can run with a stale `first` & show your users old data.",
      },
      {
        line: 5,
        column: 46,
        nodeType: "ArrayExpression",
        message: "`useScopedEffect` can run with a stale `second` & show your users old data.",
      },
    ]);
    expect(
      descriptors.map((descriptor) =>
        descriptor.contextNodes?.map((node) =>
          code.slice(getNodeStartIndex(node), getNodeEndIndex(node)),
        ),
      ),
    ).toEqual([
      ["useScopedEffect(() => console.info(first), [])", "() => console.info(first)"],
      ["useScopedEffect(() => console.info(second), [])", "() => console.info(second)"],
    ]);
  });

  it("keeps distinct completion sets for two forwarders and an early return", () => {
    const result = runRule(
      exhaustiveDeps,
      `
import { useEffect, useLayoutEffect } from "react";
const useScopedEffect = (callback, dependencies) => useEffect(callback, dependencies);
const useScopedLayout = (callback, dependencies) => useLayoutEffect(callback, dependencies);
const Panel = ({ first, second }) => {
  let stored;
  useScopedEffect(() => console.info(first), []);
  useScopedLayout(() => { stored = second; }, []);
};`,
      {
        settings: {
          "react-doctor": { exhaustiveDeps: { additionalHooks: "^useScoped(?:Effect|Layout)$" } },
        },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(
      result.diagnostics.filter((diagnostic) => diagnostic.message.includes("stale `first`")),
    ).toHaveLength(1);
    expect(
      result.diagnostics
        .filter((diagnostic) => diagnostic.message.includes("callback is defined elsewhere"))
        .map((diagnostic) => diagnostic.message),
    ).toEqual([
      "`useLayoutEffect`'s callback is defined elsewhere, so dependencies can't be checked and stale values can slip through.",
    ]);
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes("`stored`"))).toBe(
      true,
    );
  });

  it("requires completion of every caller of the same forwarder", () => {
    const result = runForwardingFixture({
      caller:
        "let stored; useScopedEffect(() => console.info(token), []); useScopedEffect(() => { stored = token; }, []);",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(3);
    expect(result.diagnostics[0]?.message).toBe(
      "`useScopedEffect` can run with a stale `token` & show your users old data.",
    );
    expect(result.diagnostics[1]?.message).toContain("`stored`");
    expect(result.diagnostics[2]?.message).toBe(
      "`useEffect`'s callback is defined elsewhere, so dependencies can't be checked and stale values can slip through.",
    );
  });

  it.each(
    ["curated", "faithful", undefined].flatMap((portedRuleMode) =>
      ["[]", "[token]"].flatMap((dependencies) =>
        [false, true].map((hasSourceObject) => ({
          portedRuleMode,
          dependencies,
          hasSourceObject,
        })),
      ),
    ),
  )(
    "uses the wrapped Program lifecycle for $dependencies with source object $hasSourceObject and mode $portedRuleMode",
    ({ dependencies, hasSourceObject, portedRuleMode }) => {
      const code = `import { useEffect } from "react";
const useScopedEffect = (callback, dependencies) => useEffect(callback, dependencies);
const Panel = ({ token }) => {
  useScopedEffect(() => console.info(token), ${dependencies});
};`;
      const parsed = parseFixture(code);
      expect(parsed.errors).toEqual([]);
      attachParentReferences(parsed.program);
      attachSourceLocations(parsed.program, code);
      const reports: ReportDescriptor[] = [];
      const visitors = wrapWithSemanticContext(exhaustiveDeps).create({
        report: (descriptor) => reports.push(descriptor),
        filename: "fixture.tsx",
        settings: {
          "react-doctor": {
            ...(portedRuleMode ? { portedRuleMode } : {}),
            exhaustiveDeps: { additionalHooks: "^useScopedEffect$" },
          },
        },
        ...(hasSourceObject ? { sourceCode: { getText: () => code } } : {}),
      });
      visitors.Program?.(parsed.program);
      walkAst(parsed.program, (node) => {
        if (isNodeOfType(node, "CallExpression")) visitors.CallExpression?.(node);
      });
      visitors["Program:exit"]?.(parsed.program);
      const expectedReports: RuleDiagnostic[] = [];
      if (portedRuleMode !== "curated") {
        expectedReports.push({
          message:
            "`useEffect`'s callback is defined elsewhere, so dependencies can't be checked and stale values can slip through.",
          nodeType: "Identifier",
          line: 2,
          column: 62,
        });
      }
      if (dependencies === "[]") {
        expectedReports.push({
          message: "`useScopedEffect` can run with a stale `token` & show your users old data.",
          nodeType: "ArrayExpression",
          line: 4,
          column: 45,
        });
      }
      expect(
        reports.map((descriptor) => ({
          message: descriptor.message,
          nodeType: descriptor.node.type,
          line: descriptor.node.loc?.start.line,
          column: descriptor.node.loc?.start.column,
        })),
      ).toEqual(expectedReports);
    },
  );
});
