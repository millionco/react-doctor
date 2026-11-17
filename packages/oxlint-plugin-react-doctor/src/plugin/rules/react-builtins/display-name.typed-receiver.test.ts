import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { displayName } from "./display-name.js";

const typedReceiverSettings = {
  "react-doctor": {
    portedRuleMode: "curated",
    capabilities: ["react"],
  },
};

const typedReceiverCases = [
  {
    name: "adjacent-asserted-same-binding",
    code: "import { forwardRef } from 'react';\ninterface DisplayTarget { displayName?: string }\nexport const Preview = forwardRef((props, ref) => <div ref={ref} />);\n(Preview as DisplayTarget).displayName = 'Preview';\n",
    filename: "/synthetic/display-name-cast-receiver/case-00.tsx",
    expectedCount: 0,
  },
  {
    name: "nested-type-assertions-same-binding",
    code: "import { forwardRef } from 'react';\ninterface DisplayTarget { displayName?: string }\nexport const Preview = forwardRef((props, ref) => <div ref={ref} />);\n((Preview as unknown) as DisplayTarget).displayName = 'Preview';\n",
    filename: "/synthetic/display-name-cast-receiver/case-01.tsx",
    expectedCount: 0,
  },
  {
    name: "initializer-and-receiver-assertions",
    code: "import { forwardRef } from 'react';\ninterface DisplayTarget { displayName?: string }\nexport const Preview = forwardRef((props, ref) => <div ref={ref} />) as DisplayTarget;\n(Preview as DisplayTarget).displayName = 'Preview';\n",
    filename: "/synthetic/display-name-cast-receiver/case-02.tsx",
    expectedCount: 0,
  },
  {
    name: "plain-existing-assignment",
    code: "import { forwardRef } from 'react';\ninterface DisplayTarget { displayName?: string }\nexport const Preview = forwardRef((props, ref) => <div ref={ref} />);\nPreview.displayName = 'Preview';\n",
    filename: "/synthetic/display-name-cast-receiver/case-03.tsx",
    expectedCount: 0,
  },
  {
    name: "missing-assignment",
    code: "import { forwardRef } from 'react';\ninterface DisplayTarget { displayName?: string }\nexport const Preview = forwardRef((props, ref) => <div ref={ref} />);\n",
    filename: "/synthetic/display-name-cast-receiver/case-04.tsx",
    expectedCount: 1,
  },
  {
    name: "different-binding",
    code: "import { forwardRef } from 'react';\ninterface DisplayTarget { displayName?: string }\nconst Other = {};\nexport const Preview = forwardRef((props, ref) => <div ref={ref} />);\n(Other as DisplayTarget).displayName = 'Preview';\n",
    filename: "/synthetic/display-name-cast-receiver/case-05.tsx",
    expectedCount: 1,
  },
  {
    name: "shadowed-nested-binding",
    code: "import { forwardRef } from 'react';\ninterface DisplayTarget { displayName?: string }\nexport const Preview = forwardRef((props, ref) => <div ref={ref} />);\nexport const nameOther = () => { const Preview = {}; (Preview as DisplayTarget).displayName = 'Preview'; };\n",
    filename: "/synthetic/display-name-cast-receiver/case-06.tsx",
    expectedCount: 1,
  },
  {
    name: "runtime-call-receiver",
    code: "import { forwardRef } from 'react';\ninterface DisplayTarget { displayName?: string }\nexport const Preview = forwardRef((props, ref) => <div ref={ref} />);\nconst copy = (value) => ({ ...value });\n(copy(Preview) as DisplayTarget).displayName = 'Preview';\n",
    filename: "/synthetic/display-name-cast-receiver/case-07.tsx",
    expectedCount: 1,
  },
  {
    name: "conditional-assignment",
    code: "import { forwardRef } from 'react';\ninterface DisplayTarget { displayName?: string }\nexport const Preview = forwardRef((props, ref) => <div ref={ref} />);\nif (flag) (Preview as DisplayTarget).displayName = 'Preview';\n",
    filename: "/synthetic/display-name-cast-receiver/case-08.tsx",
    expectedCount: 1,
  },
  {
    name: "compound-assignment",
    code: "import { forwardRef } from 'react';\ninterface DisplayTarget { displayName?: string }\nexport const Preview = forwardRef((props, ref) => <div ref={ref} />);\n(Preview as DisplayTarget).displayName += 'Preview';\n",
    filename: "/synthetic/display-name-cast-receiver/case-09.tsx",
    expectedCount: 1,
  },
  {
    name: "empty-name",
    code: "import { forwardRef } from 'react';\ninterface DisplayTarget { displayName?: string }\nexport const Preview = forwardRef((props, ref) => <div ref={ref} />);\n(Preview as DisplayTarget).displayName = '';\n",
    filename: "/synthetic/display-name-cast-receiver/case-10.tsx",
    expectedCount: 1,
  },
  {
    name: "computed-name",
    code: "import { forwardRef } from 'react';\ninterface DisplayTarget { displayName?: string }\nexport const Preview = forwardRef((props, ref) => <div ref={ref} />);\n(Preview as DisplayTarget)['displayName'] = 'Preview';\n",
    filename: "/synthetic/display-name-cast-receiver/case-11.tsx",
    expectedCount: 0,
  },
  {
    name: "intervening-call",
    code: "import { forwardRef } from 'react';\ninterface DisplayTarget { displayName?: string }\nexport const Preview = forwardRef((props, ref) => <div ref={ref} />);\nconsume(Preview);\n(Preview as DisplayTarget).displayName = 'Preview';\n",
    filename: "/synthetic/display-name-cast-receiver/case-12.tsx",
    expectedCount: 1,
  },
  {
    name: "mutable-selected-binding",
    code: "import { forwardRef } from 'react';\ninterface DisplayTarget { displayName?: string }\nexport let Preview = forwardRef((props, ref) => <div ref={ref} />);\n(Preview as DisplayTarget).displayName = 'Preview';\n",
    filename: "/synthetic/display-name-cast-receiver/case-13.tsx",
    expectedCount: 1,
  },
  {
    name: "separate-value-alias",
    code: "import { forwardRef } from 'react';\ninterface DisplayTarget { displayName?: string }\nexport const Preview = forwardRef((props, ref) => <div ref={ref} />);\nconst Alias = Preview;\n(Alias as DisplayTarget).displayName = 'Preview';\n",
    filename: "/synthetic/display-name-cast-receiver/case-14.tsx",
    expectedCount: 1,
  },
  {
    name: "never-called-assignment-function",
    code: "import { forwardRef } from 'react';\ninterface DisplayTarget { displayName?: string }\nexport const Preview = forwardRef((props, ref) => <div ref={ref} />);\nconst assignName = () => { (Preview as DisplayTarget).displayName = 'Preview'; };\n",
    filename: "/synthetic/display-name-cast-receiver/case-15.tsx",
    expectedCount: 1,
  },
  {
    name: "later-delete",
    code: "import { forwardRef } from 'react';\ninterface DisplayTarget { displayName?: string }\nexport const Preview = forwardRef((props, ref) => <div ref={ref} />);\n(Preview as DisplayTarget).displayName = 'Preview';\ndelete (Preview as DisplayTarget).displayName;\n",
    filename: "/synthetic/display-name-cast-receiver/independent-16.tsx",
    expectedCount: 1,
  },
  {
    name: "later-empty-write",
    code: "import { forwardRef } from 'react';\ninterface DisplayTarget { displayName?: string }\nexport const Preview = forwardRef((props, ref) => <div ref={ref} />);\n(Preview as DisplayTarget).displayName = 'Preview';\n(Preview as DisplayTarget).displayName = '';\n",
    filename: "/synthetic/display-name-cast-receiver/independent-17.tsx",
    expectedCount: 1,
  },
  {
    name: "unknown-value-transport",
    code: "import { forwardRef } from 'react';\ninterface DisplayTarget { displayName?: string }\nexport const Preview = forwardRef((props, ref) => <div ref={ref} />);\n(Preview as DisplayTarget).displayName = 'Preview';\nconsume(Preview);\n",
    filename: "/synthetic/display-name-cast-receiver/independent-18.tsx",
    expectedCount: 1,
  },
  {
    name: "separate-exported-value-alias",
    code: "import { forwardRef } from 'react';\ninterface DisplayTarget { displayName?: string }\nexport const Preview = forwardRef((props, ref) => <div ref={ref} />);\n(Preview as DisplayTarget).displayName = 'Preview';\nexport const Alias = Preview;\n",
    filename: "/synthetic/display-name-cast-receiver/independent-19.tsx",
    expectedCount: 1,
  },
  {
    name: "reflective-delete",
    code: "import { forwardRef } from 'react';\ninterface DisplayTarget { displayName?: string }\nexport const Preview = forwardRef((props, ref) => <div ref={ref} />);\n(Preview as DisplayTarget).displayName = 'Preview';\nReflect.deleteProperty(Preview, 'displayName');\n",
    filename: "/synthetic/display-name-cast-receiver/independent-20.tsx",
    expectedCount: 1,
  },
  {
    name: "optional-runtime-receiver",
    code: "import { forwardRef } from 'react';\ninterface DisplayTarget { displayName?: string }\nexport const Preview = forwardRef((props, ref) => <div ref={ref} />);\n(Preview?.valueOf() as DisplayTarget).displayName = 'Preview';\n",
    filename: "/synthetic/display-name-cast-receiver/independent-21.tsx",
    expectedCount: 1,
  },
  {
    name: "sequence-receiver",
    code: "import { forwardRef } from 'react';\ninterface DisplayTarget { displayName?: string }\nexport const Preview = forwardRef((props, ref) => <div ref={ref} />);\n((0, Preview) as DisplayTarget).displayName = 'Preview';\n",
    filename: "/synthetic/display-name-cast-receiver/independent-22.tsx",
    expectedCount: 1,
  },
  {
    name: "nested-erased-receiver",
    code: "import { forwardRef } from 'react';\ninterface DisplayTarget { displayName?: string }\nexport const Preview = forwardRef((props, ref) => <div ref={ref} />);\n((Preview! satisfies unknown) as DisplayTarget).displayName = 'Preview';\n",
    filename: "/synthetic/display-name-cast-receiver/independent-23.tsx",
    expectedCount: 0,
  },
  {
    name: "multiple-declarators",
    code: "import { forwardRef } from 'react';\ninterface DisplayTarget { displayName?: string }\nexport const Preview = forwardRef((props, ref) => <div ref={ref} />), Other = {};\n(Preview as DisplayTarget).displayName = 'Preview';\n",
    filename: "/synthetic/display-name-cast-receiver/guard-multiple-declarators.tsx",
    expectedCount: 1,
  },
  {
    name: "whitespace-only-name",
    code: "import { forwardRef } from 'react';\ninterface DisplayTarget { displayName?: string }\nexport const Preview = forwardRef((props, ref) => <div ref={ref} />);\n(Preview as DisplayTarget).displayName = ' \\t ';\n",
    filename: "/synthetic/display-name-cast-receiver/guard-whitespace-only-name.tsx",
    expectedCount: 1,
  },
  {
    name: "initializer-ts-instantiation",
    code: "import { forwardRef } from 'react';\ninterface DisplayTarget { displayName?: string }\nexport const Preview = (forwardRef((props, ref) => <div ref={ref} />))<unknown>;\n(Preview as DisplayTarget).displayName = 'Preview';\n",
    filename: "/synthetic/display-name-cast-receiver/guard-initializer-ts-instantiation.tsx",
    expectedCount: 1,
  },
  {
    name: "receiver-ts-instantiation",
    code: "import { forwardRef } from 'react';\ninterface DisplayTarget { displayName?: string }\nexport const Preview = forwardRef((props, ref) => <div ref={ref} />);\n((Preview<unknown>) as DisplayTarget).displayName = 'Preview';\n",
    filename: "/synthetic/display-name-cast-receiver/guard-receiver-ts-instantiation.tsx",
    expectedCount: 1,
  },
  {
    name: "static-template-property",
    code: "import { forwardRef } from 'react';\ninterface DisplayTarget { displayName?: string }\nexport const Preview = forwardRef((props, ref) => <div ref={ref} />);\n(Preview as DisplayTarget)[`displayName`] = 'Preview';\n",
    filename: "/synthetic/display-name-cast-receiver/guard-static-template-property.tsx",
    expectedCount: 1,
  },
  {
    name: "chained-name-assignment",
    code: "import { forwardRef } from 'react';\ninterface DisplayTarget { displayName?: string }\nexport const Preview = forwardRef((props, ref) => <div ref={ref} />);\notherName = (Preview as DisplayTarget).displayName = 'Preview';\n",
    filename: "/synthetic/display-name-cast-receiver/guard-chained-name-assignment.tsx",
    expectedCount: 1,
  },
  {
    name: "direct-global-eval",
    code: "import { forwardRef } from 'react';\ninterface DisplayTarget { displayName?: string }\nexport const Preview = forwardRef((props, ref) => <div ref={ref} />);\n(Preview as DisplayTarget).displayName = 'Preview';\neval(\"Preview.displayName = ''\");\n",
    filename: "/synthetic/display-name-cast-receiver/guard-direct-global-eval.tsx",
    expectedCount: 1,
  },
  {
    name: "global-object-eval",
    code: "import { forwardRef } from 'react';\ninterface DisplayTarget { displayName?: string }\nexport const Preview = forwardRef((props, ref) => <div ref={ref} />);\n(Preview as DisplayTarget).displayName = 'Preview';\nglobalThis[\"eval\"](\"Preview.displayName = ''\");\n",
    filename: "/synthetic/display-name-cast-receiver/guard-global-object-eval.tsx",
    expectedCount: 1,
  },
  {
    name: "shadowed-eval-method",
    code: "import { forwardRef } from 'react';\ninterface DisplayTarget { displayName?: string }\nconst evaluator = { eval: (_source: string) => {} };\nexport const Preview = forwardRef((props, ref) => <div ref={ref} />);\n(Preview as DisplayTarget).displayName = 'Preview';\nevaluator.eval(\"Preview.displayName = ''\");\n",
    filename: "/synthetic/display-name-cast-receiver/guard-shadowed-eval-method.tsx",
    expectedCount: 0,
  },
  {
    name: "ambient-window-eval",
    code: "import { forwardRef } from 'react';\ndeclare const window: { eval(source: string): unknown };\ninterface DisplayTarget { displayName?: string }\nexport const Preview = forwardRef((props, ref) => <div ref={ref} />);\n(Preview as DisplayTarget).displayName = 'Preview';\nwindow.eval(\"Preview.displayName = ''\");\n",
    filename: "/synthetic/display-name-cast-receiver/independent-ambient-window-eval.tsx",
    expectedCount: 1,
  },
  {
    name: "erased-window-eval-type-alias",
    code: "import { forwardRef } from 'react';\ntype window = { eval(source: string): unknown };\ninterface DisplayTarget { displayName?: string }\nexport const Preview = forwardRef((props, ref) => <div ref={ref} />);\n(Preview as DisplayTarget).displayName = 'Preview';\nwindow.eval(\"Preview.displayName = ''\");\n",
    filename: "/synthetic/display-name-cast-receiver/independent-erased-window-eval-type-alias.tsx",
    expectedCount: 1,
  },
  {
    name: "erased-global-this-interface",
    code: "import { forwardRef } from 'react';\ninterface globalThis { eval(source: string): unknown }\ninterface DisplayTarget { displayName?: string }\nexport const Preview = forwardRef((props, ref) => <div ref={ref} />);\n(Preview as DisplayTarget).displayName = 'Preview';\nglobalThis.eval(\"Preview.displayName = ''\");\n",
    filename: "/synthetic/display-name-cast-receiver/independent-erased-global-this-interface.tsx",
    expectedCount: 1,
  },
];

describe("display-name typed naming receivers", () => {
  for (const control of typedReceiverCases) {
    it(control.name, () => {
      const result = runRule(displayName, control.code, {
        filename: control.filename,
        settings: typedReceiverSettings,
        includeLocations: true,
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(control.expectedCount);
    });
  }
});
