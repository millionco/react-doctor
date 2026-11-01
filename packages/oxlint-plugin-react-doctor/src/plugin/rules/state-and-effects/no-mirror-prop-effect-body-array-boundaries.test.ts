import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noMirrorPropEffect } from "./no-mirror-prop-effect.js";

interface BodyArrayMirrorBoundaryCase {
  name: string;
  filename: string;
  code: string;
  expectedCount: number;
}

const cases: ReadonlyArray<BodyArrayMirrorBoundaryCase> = [
  {
    name: "typed-shorthand-positive",
    filename: "/synthetic/2120-middle-review/typed-shorthand-positive.tsx",
    code: 'import { useEffect, useState } from "react";\ninterface ArrayProps { data: string[] }\nexport const Panel = (props: ArrayProps) => {\n  const { data } = props;\n  const [draft, setDraft] = useState(data);\n  \n  useEffect(() => { setDraft(data); }, [data]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n',
    expectedCount: 1,
  },
  {
    name: "erased-props-interface",
    filename: "/synthetic/2120-middle-review/erased-props-interface.tsx",
    code: 'import { useEffect, useState } from "react";\ninterface ArrayProps { data: string[] }\nexport const Panel = (props: ArrayProps) => {\n  interface props {}\n  const { data: sourceValue } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n',
    expectedCount: 1,
  },
  {
    name: "erased-alias-interface",
    filename: "/synthetic/2120-middle-review/erased-alias-interface.tsx",
    code: 'import { useEffect, useState } from "react";\ninterface ArrayProps { data: string[] }\nexport const Panel = (props: ArrayProps) => {\n  const { data: sourceValue } = props;\n  interface sourceValue {}\n  const [draft, setDraft] = useState(sourceValue);\n  \n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n',
    expectedCount: 1,
  },
  {
    name: "erased-setter-interface",
    filename: "/synthetic/2120-middle-review/erased-setter-interface.tsx",
    code: 'import { useEffect, useState } from "react";\ninterface ArrayProps { data: string[] }\nexport const Panel = (props: ArrayProps) => {\n  const { data: sourceValue } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  interface setDraft {}\n  \n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n',
    expectedCount: 1,
  },
  {
    name: "erased-useState-interface",
    filename: "/synthetic/2120-middle-review/erased-useState-interface.tsx",
    code: 'import { useEffect, useState } from "react";\ninterface useState {}\ninterface ArrayProps { data: string[] }\nexport const Panel = (props: ArrayProps) => {\n  const { data: sourceValue } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n',
    expectedCount: 1,
  },
  {
    name: "erased-useEffect-interface",
    filename: "/synthetic/2120-middle-review/erased-useEffect-interface.tsx",
    code: 'import { useEffect, useState } from "react";\ninterface useEffect {}\ninterface ArrayProps { data: string[] }\nexport const Panel = (props: ArrayProps) => {\n  const { data: sourceValue } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n',
    expectedCount: 1,
  },
  {
    name: "setter-escape-control",
    filename: "/synthetic/2120-middle-review/setter-escape-control.tsx",
    code: 'import { useEffect, useState } from "react";\ninterface ArrayProps { data: string[] }\nexport const Panel = (props: ArrayProps) => {\n  const { data: sourceValue } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  const leakedSetter = setDraft; void leakedSetter;\n  \n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n',
    expectedCount: 0,
  },
  {
    name: "actual-eval-control",
    filename: "/synthetic/2120-middle-review/actual-eval-control.tsx",
    code: 'import { useEffect, useState } from "react";\neval("void 0");\ninterface ArrayProps { data: string[] }\nexport const Panel = (props: ArrayProps) => {\n  const { data: sourceValue } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n',
    expectedCount: 0,
  },
];

describe("body array prop mirror binding boundaries", () => {
  for (const control of cases) {
    it(control.name, () => {
      const result = runRule(noMirrorPropEffect, control.code, {
        filename: control.filename,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
        includeLocations: true,
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(control.expectedCount);
    });
  }
});
