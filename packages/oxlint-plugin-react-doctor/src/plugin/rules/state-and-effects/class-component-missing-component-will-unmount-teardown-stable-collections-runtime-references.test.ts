import { describe, expect, it } from "vite-plus/test";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { runRule, runRuleOnParsedFixture } from "../../../test-utils/run-rule.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import { walkAst } from "../../utils/walk-ast.js";
import { classComponentMissingComponentWillUnmountTeardown } from "./class-component-missing-component-will-unmount-teardown.js";
import { collectStableMatcherCleanedNativeAcquisitions } from "./utils/collect-stable-matcher-cleaned-native-acquisitions.js";

const NOMINAL_MATCHER_SOURCE =
  'import React from "react";\ninterface ListenerProps {\n  queries: Record<string, string>;\n}\nexport const createListenerComponents = () => ({\n  Provider: class ListenerProvider extends React.Component<ListenerProps> {\n    constructor(props: ListenerProps) {\n      super(props);\n      this.state = {\n        matchers: this.setupMatchers(props.queries),\n        changeCount: 0,\n      };\n    }\n    setupMatchers = (queries: Record<string, string>) =>\n      Object.keys(queries).reduce(\n        (matchers, queryKey) => ({\n          ...matchers,\n          [queryKey]: window.matchMedia(queries[queryKey]),\n        }),\n        {},\n      );\n    handleChange = () => {\n      this.setState({ changeCount: 1 });\n    };\n    componentDidMount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.addListener(handleChange);\n        });\n      }\n    }\n    componentWillUnmount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.removeListener(handleChange);\n        });\n      }\n    }\n    render() {\n      return null;\n    }\n  },\n});\n';

const WARNING_MESSAGE =
  "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.";

const certificateRule: Rule = {
  id: "stable-matcher-certificate-test",
  severity: "warn",
  create: (context) => ({
    ClassBody: (classBody) => {
      if (!isNodeOfType(classBody, "ClassBody")) return;
      const acquisitions = collectStableMatcherCleanedNativeAcquisitions({
        classBody,
        context,
        resolveMember: (name) => {
          for (const member of classBody.body) {
            if (
              (isNodeOfType(member, "MethodDefinition") ||
                isNodeOfType(member, "PropertyDefinition")) &&
              getStaticPropertyKeyName(member, { allowComputedString: true }) === name
            )
              return member.value ?? null;
          }
          return null;
        },
      });
      for (const node of acquisitions)
        context.report({ node, message: "closed native collection" });
    },
  }),
};

const runtimeCapabilities = [
  {
    name: "direct-runtime-Function-provider-replacement",
    prefix:
      'Function("const values=Object.values;let calls=0;Object.values=record=>++calls===1?values(record):[]")();\n',
    diagnosticLine: 30,
  },
  {
    name: "catch-default-runtime-Function-provider-replacement",
    prefix:
      'try { throw {}; } catch ({ ignored = Function("const values=Object.values;let calls=0;Object.values=record=>++calls===1?values(record):[]")() }) {}\n',
    diagnosticLine: 30,
  },
  {
    name: "catch-default-runtime-eval-provider-replacement",
    prefix:
      'try { throw {}; } catch ({ ignored = eval("const values=Object.values;let calls=0;Object.values=record=>++calls===1?values(record):[]") }) {}\n',
    diagnosticLine: 30,
  },
  {
    name: "catch-default-type-erased-Function-provider-replacement",
    prefix:
      'type Function = unknown;\ntry { throw {}; } catch ({ ignored = Function("const values=Object.values;let calls=0;Object.values=record=>++calls===1?values(record):[]")() }) {}\n',
    diagnosticLine: 31,
  },
  {
    name: "catch-default-typed-Function-provider-replacement",
    prefix:
      'try { throw {}; } catch ({ ignored = (Function as any)("const values=Object.values;let calls=0;Object.values=record=>++calls===1?values(record):[]")() }) {}\n',
    diagnosticLine: 30,
  },
  {
    name: "catch computed key retains runtime Function capability",
    prefix:
      'try { throw {}; } catch ({ [Function("const values=Object.values;let calls=0;Object.values=record=>++calls===1?values(record):[]")()]: _ignored }) {}\n',
    diagnosticLine: 30,
  },
  {
    name: "catch default retains typed eval capability",
    prefix:
      'try { throw {}; } catch ({ _ignored = (eval as any)("const values=Object.values;let calls=0;Object.values=record=>++calls===1?values(record):[]") }) {}\n',
    diagnosticLine: 30,
  },
  {
    name: "type-only import does not shadow runtime Function",
    prefix:
      'import type { Function } from "./provider-types";\nFunction("const values=Object.values;let calls=0;Object.values=record=>++calls===1?values(record):[]")();\n',
    diagnosticLine: 31,
  },
  {
    name: "ambient declaration does not shadow runtime Function",
    prefix:
      'declare const Function: (source: string) => () => void;\nFunction("const values=Object.values;let calls=0;Object.values=record=>++calls===1?values(record):[]")();\n',
    diagnosticLine: 31,
  },
];

const nonReferencePositions = [
  {
    name: "nominal closed record",
    prefix: "",
  },
  {
    name: "unused selected binding identifiers",
    prefix: "const Function = 0;\nconst Proxy = 0;\n",
  },
  {
    name: "tracked harmless local Function reference",
    prefix:
      'const Function = (_source: string) => () => undefined;\nFunction("unchanged provider");\n',
  },
  {
    name: "unused erased selected type",
    prefix: "type Function = unknown;\n",
  },
  {
    name: "selected names in erased type members",
    prefix: "interface Metadata { Function?: string; eval?: string }\n",
  },
  {
    name: "selected imported type name is syntax",
    prefix: 'import type { Function as FunctionInfo } from "./provider-types";\n',
  },
  {
    name: "selected exported alias is syntax",
    prefix: "const label = 1; export { label as Function };\n",
  },
  {
    name: "selected labels are syntax",
    prefix: "Function: for (;;) { break Function; }\n",
  },
  {
    name: "catch parameter is an exact binding identifier",
    prefix: "try { throw {}; } catch ({ React }) {}\n",
  },
];

const catchDefaultReferenceCases = [
  {
    name: "catch default React import runtime reference is indexed",
    expectedCertificate: true,
    prefix: "try { throw {}; } catch ({ _ignored = consume(React) }) {}\n",
  },
  {
    name: "catch default harmless local Function reference is indexed",
    expectedCertificate: true,
    prefix:
      'const Function = (_source: string) => () => undefined;\ntry { throw {}; } catch ({ ignored = Function("const values=Object.values;let calls=0;Object.values=record=>++calls===1?values(record):[]")() }) {}\n',
  },
  {
    name: "catch default Object namespace identity is uncertain",
    expectedCertificate: false,
    prefix: "try { throw {}; } catch ({ _ignored = consume(Object) }) {}\n",
  },
  {
    name: "catch default window namespace identity is uncertain",
    expectedCertificate: false,
    prefix: "try { throw {}; } catch ({ _ignored = consume(window) }) {}\n",
  },
  {
    name: "catch default renamed genuine React import reference is indexed",
    expectedCertificate: true,
    prefix:
      'import RuntimeReact from "react";\ntry { throw {}; } catch ({ _ignored = consume(RuntimeReact) }) {}\n',
  },
];

describe("stable matcher collection runtime reference census", () => {
  it.each(runtimeCapabilities)("$name", ({ prefix, diagnosticLine }) => {
    const actual = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      prefix + NOMINAL_MATCHER_SOURCE,
      {
        filename: "synthetic-stable-matcher-collection.tsx",
        includeLocations: true,
      },
    );
    expect(actual.parseErrors).toEqual([]);
    expect(actual.diagnostics).toEqual([
      { column: 10, line: diagnosticLine, message: WARNING_MESSAGE, nodeType: "CallExpression" },
    ]);
  });

  it.each(nonReferencePositions)("$name", ({ prefix }) => {
    const actual = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      prefix + NOMINAL_MATCHER_SOURCE,
      {
        filename: "synthetic-stable-matcher-collection.tsx",
      },
    );
    expect(actual.parseErrors).toEqual([]);
    expect(actual.diagnostics).toEqual([]);
  });

  it.each(catchDefaultReferenceCases)("$name", ({ prefix, expectedCertificate }) => {
    const actual = runRule(certificateRule, prefix + NOMINAL_MATCHER_SOURCE);
    expect(actual.parseErrors).toEqual([]);
    expect(actual.diagnostics).toEqual(
      expectedCertificate
        ? [{ message: "closed native collection", nodeType: "CallExpression" }]
        : [],
    );
  });

  it.each([
    {
      name: "shorthand catch binding",
      prefix: "try { throw {}; } catch ({ React }) {}\n",
      accepted: true,
    },
    {
      name: "shorthand assignment value",
      prefix: "try { throw {}; } catch ({ _ignored = ({ React } = { React: null }) }) {}\n",
      accepted: false,
    },
  ])("preserves identical-node $name", ({ prefix, accepted }) => {
    const code = prefix + NOMINAL_MATCHER_SOURCE;
    const parsed = parseFixture(code, { filename: "synthetic-stable-matcher-collection.tsx" });
    walkAst(parsed.program, (node) => {
      if (
        isNodeOfType(node, "Property") &&
        node.shorthand &&
        isNodeOfType(node.value, "Identifier") &&
        node.value.name === "React"
      )
        Object.assign(node, { key: node.value });
    });
    const actual = runRuleOnParsedFixture(certificateRule, code, parsed);
    expect(actual.parseErrors).toEqual([]);
    expect(actual.diagnostics).toEqual(
      accepted ? [{ message: "closed native collection", nodeType: "CallExpression" }] : [],
    );
  });
});
