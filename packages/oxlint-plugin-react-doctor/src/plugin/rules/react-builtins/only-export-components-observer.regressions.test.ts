import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RunRuleOptions } from "../../../test-utils/run-rule.js";
import { onlyExportComponents } from "./only-export-components.js";

interface ObserverTestCase {
  name: string;
  code: string;
  expected: number;
  options?: RunRuleOptions;
}

const commonOptions: RunRuleOptions = {
  filename: "src/observer-role.tsx",
  settings: {
    "react-doctor": {
      framework: "vite",
    },
  },
};

const cases: ObserverTestCase[] = [
  ...[
    "import type require = require('provider-types'); require('mobx-react-lite').observer = () => 42;",
    "declare const require: any; require('mobx-react-lite').observer = () => 42;",
    "declare let require: any; require('mobx-react-lite').observer = () => 42;",
    "declare var require: any; require('mobx-react-lite').observer = () => 42;",
    "declare const globalThis: any; globalThis.require('mobx-react-lite').observer = () => 42;",
    "declare const module: any; module.require('mobx-react-lite').observer = () => 42;",
    "declare class require {} require('mobx-react-lite').observer = () => 42;",
    "interface require {} require('mobx-react-lite').observer = () => 42;",
    "type require = unknown; require('mobx-react-lite').observer = () => 42;",
    "import type require from 'loader'; require('mobx-react-lite').observer = () => 42;",
    "import { type require } from 'loader'; require('mobx-react-lite').observer = () => 42;",
  ].map((providerSource) => ({
    name: `erased provider cannot hide runtime mutation: ${providerSource}`,
    code: `import { observer } from 'mobx-react-lite'; ${providerSource} const Badge = observer(() => <span />); export const Card = () => <Badge />; export default Badge;`,
    expected: 1,
  })),
  ...[
    "declare const require: unknown;",
    "declare const globalThis: unknown;",
    "declare class require {}",
    "import type require from 'loader';",
    "interface require {}",
    "type require = unknown;",
    "const require = (_source: string) => ({ observer: 0 }); require('other').observer = 1;",
    "const require = (_source: string) => ({ observer: 0 }); interface require {} require('other').observer = 1;",
    "interface require {} const require = (_source: string) => ({ observer: 0 }); require('other').observer = 1;",
    "const require = (_source: string) => ({ observer: 0 }); function localLoader() { interface require {} require('other').observer = 1; }",
  ].map((providerSource) => ({
    name: `inert declarations and runtime locals remain supported: ${providerSource}`,
    code: `import { observer } from 'mobx-react-lite'; ${providerSource} const Badge = observer(() => <span />); export const Card = () => <Badge />; export default Badge;`,
    expected: 0,
  })),
  {
    name: "value import-equals stays outside the closed observer profile",
    code: "import { observer } from 'mobx-react-lite'; import require = require('local-loader'); require('other').observer = 1; const Badge = observer(() => <span />); export const Card = () => <Badge />; export default Badge;",
    expected: 1,
  },
  {
    name: "canonical-named-observer-component",
    code: "import { observer } from 'mobx-react-lite';\nconst Badge = observer(() => <span />);\nexport const Card = () => <Badge />;\nexport default Badge;\n",
    expected: 0,
  },
  {
    name: "canonical-renamed-value-import",
    code: "import { observer as watch } from 'mobx-react-lite';\nconst Badge = watch(() => <span />);\nexport const Card = () => <Badge />;\nexport default Badge;\n",
    expected: 0,
  },
  {
    name: "legacy-native-memo-component",
    code: "import { memo } from 'react';\nconst Badge = memo(() => <span />);\nexport const Card = () => <Badge />;\nexport default Badge;\n",
    expected: 0,
  },
  {
    name: "legacy-direct-component",
    code: "export const Badge = () => <span />;\nexport const Card = () => <Badge />;\n",
    expected: 0,
  },
  {
    name: "mixed-utility-export",
    code: "import { observer } from 'mobx-react-lite';\nconst Badge = observer(() => <span />);\nexport const Card = () => <Badge />;\nexport default Badge;\nexport const readAmount = () => 4;\n",
    expected: 1,
  },
  {
    name: "local-same-spelling-factory",
    code: "const observer = callback => ({ callback });\nconst Badge = observer(() => <span />);\nexport const Card = () => <Badge />;\nexport default Badge;\n",
    expected: 1,
  },
  {
    name: "foreign-same-spelling-import",
    code: "import { observer } from './foreign';\nconst Badge = observer(() => <span />);\nexport const Card = () => <Badge />;\nexport default Badge;\n",
    expected: 1,
  },
  {
    name: "type-only-provider-runtime-use",
    code: "import type { observer } from 'mobx-react-lite';\nconst Badge = observer(() => <span />);\nexport const Card = () => <Badge />;\nexport default Badge;\n",
    expected: 1,
  },
  {
    name: "namespace-carrier",
    code: "import * as provider from 'mobx-react-lite';\nconst Badge = provider.observer(() => <span />);\nexport const Card = () => <Badge />;\nexport default Badge;\n",
    expected: 1,
  },
  {
    name: "default-carrier",
    code: "import provider from 'mobx-react-lite';\nconst Badge = provider(() => <span />);\nexport const Card = () => <Badge />;\nexport default Badge;\n",
    expected: 1,
  },
  {
    name: "provider-reassignment",
    code: "import { observer } from 'mobx-react-lite';\nobserver = replacement;\nconst Badge = observer(() => <span />);\nexport const Card = () => <Badge />;\nexport default Badge;\n",
    expected: 1,
  },
  {
    name: "mutable-result-replacement",
    code: "import { observer } from 'mobx-react-lite';\nlet Badge = observer(() => <span />);\nexport const Card = () => <Badge />;\nexport default Badge;\nBadge = replacement;\n",
    expected: 1,
  },
  {
    name: "result-unknown-consumer",
    code: "import { observer } from 'mobx-react-lite';\nconst Badge = observer(() => <span />);\nexport const Card = () => <Badge />;\nexport default Badge;\nconsume(Badge);\n",
    expected: 1,
  },
  {
    name: "optional-provider-call",
    code: "import { observer } from 'mobx-react-lite';\nconst Badge = observer?.(() => <span />);\nexport const Card = () => <Badge />;\nexport default Badge;\n",
    expected: 1,
  },
  {
    name: "computed-namespace-call",
    code: "import * as provider from 'mobx-react-lite';\nconst Badge = provider['observer'](() => <span />);\nexport const Card = () => <Badge />;\nexport default Badge;\n",
    expected: 1,
  },
  {
    name: "object-returning-input",
    code: "import { observer } from 'mobx-react-lite';\nconst Badge = observer(() => ({ label: 4 }));\nexport const Card = () => <Badge />;\nexport default Badge;\n",
    expected: 1,
  },
  {
    name: "explicit-existing-custom-hoc-setting",
    code: "import { observer } from 'mobx-react-lite';\nconst Badge = observer(() => <span />);\nexport const Card = () => <Badge />;\nexport default Badge;\n",
    expected: 0,
    options: {
      filename: "src/observer-role.tsx",
      settings: {
        "react-doctor": { framework: "vite", onlyExportComponents: { customHOCs: ["observer"] } },
      },
    },
  },
  {
    name: "ordinary-function-render-output",
    code: "import { observer } from 'mobx-react-lite';\nconst Badge = observer(function BadgeView() { return <span />; });\nexport const Card = () => <Badge />;\nexport default Badge;\n",
    expected: 0,
  },
  {
    name: "unresolved-eval-read-abstains",
    code: "void eval;\nimport { observer } from 'mobx-react-lite';\nconst Badge = observer(() => <span />);\nexport const Card = () => <Badge />;\nexport default Badge;\n",
    expected: 1,
  },
  {
    name: "benign-eval-property-read-abstains",
    code: "const tool = { eval: inspect }; void tool.eval;\nimport { observer } from 'mobx-react-lite';\nconst Badge = observer(() => <span />);\nexport const Card = () => <Badge />;\nexport default Badge;\n",
    expected: 1,
  },
  {
    name: "runtime-enum-provider-write-abstains",
    code: "import { observer } from 'mobx-react-lite';\nenum Change { value = (observer = replacement, 0) }\nconst Badge = observer(() => <span />);\nexport const Card = () => <Badge />;\nexport default Badge;\n",
    expected: 1,
  },
  {
    name: "evaluated-type-wrapper-provider-write-abstains",
    code: "import { observer } from 'mobx-react-lite';\nvoid ((observer = replacement) as unknown);\nconst Badge = observer(() => <span />);\nexport const Card = () => <Badge />;\nexport default Badge;\n",
    expected: 1,
  },
  {
    name: "provider-array-pattern-write-abstains",
    code: "import { observer } from 'mobx-react-lite';\nconst Badge = observer(() => <span />);\nexport const Card = () => <Badge />;\nexport default Badge;\n[observer] = replacements;\n",
    expected: 1,
  },
  {
    name: "provider-object-pattern-write-abstains",
    code: "import { observer } from 'mobx-react-lite';\nconst Badge = observer(() => <span />);\nexport const Card = () => <Badge />;\nexport default Badge;\n({ observer } = replacement);\n",
    expected: 1,
  },
  {
    name: "provider-loop-target-write-abstains",
    code: "import { observer } from 'mobx-react-lite';\nconst Badge = observer(() => <span />);\nexport const Card = () => <Badge />;\nexport default Badge;\nfor (observer of replacements) {}\n",
    expected: 1,
  },
  {
    name: "result-array-pattern-write-abstains",
    code: "import { observer } from 'mobx-react-lite';\nconst Badge = observer(() => <span />);\nexport const Card = () => <Badge />;\nexport default Badge;\n[Badge] = replacements;\n",
    expected: 1,
  },
  {
    name: "result-object-pattern-write-abstains",
    code: "import { observer } from 'mobx-react-lite';\nconst Badge = observer(() => <span />);\nexport const Card = () => <Badge />;\nexport default Badge;\n({ Badge } = replacement);\n",
    expected: 1,
  },
  {
    name: "result-loop-target-write-abstains",
    code: "import { observer } from 'mobx-react-lite';\nconst Badge = observer(() => <span />);\nexport const Card = () => <Badge />;\nexport default Badge;\nfor (Badge of replacements) {}\n",
    expected: 1,
  },
  {
    name: "provider-whole-binding-escape-abstains",
    code: "import { observer } from 'mobx-react-lite';\nconst Badge = observer(() => <span />);\nexport const Card = () => <Badge />;\nexport default Badge;\nconsume(observer);\n",
    expected: 1,
  },
  {
    name: "provider-alias-transport-abstains",
    code: "import { observer } from 'mobx-react-lite';\nconst watch = observer;\nconst Badge = watch(() => <span />);\nexport const Card = () => <Badge />;\nexport default Badge;\n",
    expected: 1,
  },
  {
    name: "extra-observer-options-abstains",
    code: "import { observer } from 'mobx-react-lite';\nconst Badge = observer(() => <span />, {});\nexport const Card = () => <Badge />;\nexport default Badge;\n",
    expected: 1,
  },
  {
    name: "spread-observer-argument-abstains",
    code: "import { observer } from 'mobx-react-lite';\nconst Badge = observer(...callbacks);\nexport const Card = () => <Badge />;\nexport default Badge;\n",
    expected: 1,
  },
  {
    name: "named-callback-input-abstains",
    code: "import { observer } from 'mobx-react-lite';\nconst View = () => <span />;\nconst Badge = observer(View);\nexport const Card = () => <Badge />;\nexport default Badge;\n",
    expected: 1,
  },
  {
    name: "async-callback-input-abstains",
    code: "import { observer } from 'mobx-react-lite';\nconst Badge = observer(async () => <span />);\nexport const Card = () => <Badge />;\nexport default Badge;\n",
    expected: 1,
  },
  {
    name: "generator-callback-input-abstains",
    code: "import { observer } from 'mobx-react-lite';\nconst Badge = observer(function* () { return <span />; });\nexport const Card = () => <Badge />;\nexport default Badge;\n",
    expected: 1,
  },
  {
    name: "type-annotation-alone-does-not-prove-render",
    code: "import { observer } from 'mobx-react-lite';\nconst Badge = observer((): JSX.Element => externalValue);\nexport const Card = () => <Badge />;\nexport default Badge;\n",
    expected: 1,
  },
  {
    name: "jsx-prop-result-escape-abstains",
    code: "import { observer } from 'mobx-react-lite';\nconst Badge = observer(() => <span />);\nexport const Card = () => <Other item={Badge} />;\nexport default Badge;\n",
    expected: 1,
  },
  {
    name: "second-sdk-named-import-abstains",
    code: "import { observer as other } from 'mobx-react-lite';\nimport { observer } from 'mobx-react-lite';\nconst Badge = observer(() => <span />);\nexport const Card = () => <Badge />;\nexport default Badge;\n",
    expected: 1,
  },
  {
    name: "sdk-namespace-carrier-abstains",
    code: "import * as sdk from 'mobx-react-lite';\nvoid sdk;\nimport { observer } from 'mobx-react-lite';\nconst Badge = observer(() => <span />);\nexport const Card = () => <Badge />;\nexport default Badge;\n",
    expected: 1,
  },
  {
    name: "dynamic-module-carrier-abstains",
    code: "void import('mobx-react-lite');\nimport { observer } from 'mobx-react-lite';\nconst Badge = observer(() => <span />);\nexport const Card = () => <Badge />;\nexport default Badge;\n",
    expected: 1,
  },
  {
    name: "builtin-module-carrier-abstains",
    code: "import { createRequire } from 'node:module';\nvoid createRequire;\nimport { observer } from 'mobx-react-lite';\nconst Badge = observer(() => <span />);\nexport const Card = () => <Badge />;\nexport default Badge;\n",
    expected: 1,
  },
  {
    name: "global-object-carrier-abstains",
    code: "void globalThis;\nimport { observer } from 'mobx-react-lite';\nconst Badge = observer(() => <span />);\nexport const Card = () => <Badge />;\nexport default Badge;\n",
    expected: 1,
  },
  {
    name: "global-function-carrier-abstains",
    code: "void Function;\nimport { observer } from 'mobx-react-lite';\nconst Badge = observer(() => <span />);\nexport const Card = () => <Badge />;\nexport default Badge;\n",
    expected: 1,
  },
  {
    name: "erased-interface-annotation-allows-original-role",
    code: "import { observer } from 'mobx-react-lite';\ninterface Props { label: string }\nconst Badge: React.FC<Props> = observer(() => <span />);\nexport const Card = () => <Badge />;\nexport default Badge;\n",
    expected: 0,
  },
  {
    name: "deferred-callback-parameter-arity-is-not-export-arity",
    code: "import { observer } from 'mobx-react-lite';\nconst Badge = observer((props, context) => <span>{props.label}</span>);\nexport const Card = () => <Badge />;\nexport default Badge;\n",
    expected: 0,
  },
  {
    name: "object-containing-jsx-is-not-component",
    code: "import { observer } from 'mobx-react-lite';\nconst Badge = observer(() => ({ child: <span /> }));\nexport const Card = () => <Badge />;\nexport default Badge;\n",
    expected: 1,
  },
  {
    name: "mixed-object-and-jsx-return-is-unsupported",
    code: "import { observer } from 'mobx-react-lite';\nconst Badge = observer((props) => { if (props.ready) return { child: <span /> }; return <span />; });\nexport const Card = () => <Badge />;\nexport default Badge;\n",
    expected: 1,
  },
];

describe("only-export-components canonical observer", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = runRule(
        onlyExportComponents,
        testCase.code,
        testCase.options ?? commonOptions,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.expected);
    });
  }
});
