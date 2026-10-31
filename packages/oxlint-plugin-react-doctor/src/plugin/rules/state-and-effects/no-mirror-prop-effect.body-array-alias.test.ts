import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noMirrorPropEffect } from "./no-mirror-prop-effect.js";

const controls = [
  {
    name: "direct-renamed-body-property",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = (props) => {\n  const { data: sourceValue } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft("edited")}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/direct-renamed-body-property.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "unrelated-default-and-rest-siblings",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = (props) => {\n  const { label, data: sourceValue, loadingRowAmount = 5, ...rest } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  void label; void loadingRowAmount; void rest;\n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft("edited")}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/unrelated-default-and-rest-siblings.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "body-shorthand-property",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = (props) => {\n  const { data } = props;\n  const [draft, setDraft] = useState(data);\n  \n  useEffect(() => { setDraft(data); }, [data]);\n  return <button onClick={() => setDraft("edited")}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/body-shorthand-property.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "parameter-alias-legacy-control",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = ({ data: sourceValue }) => {\n  \n  const [draft, setDraft] = useState(sourceValue);\n  \n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft("edited")}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/parameter-alias-legacy-control.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 1,
  },
  {
    name: "source-initial-only-alias",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = (props) => {\n  const { initialData: sourceValue } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft("edited")}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/source-initial-only-alias.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "local-initial-only-alias",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = (props) => {\n  const { data: initialValue } = props;\n  const [draft, setDraft] = useState(initialValue);\n  \n  useEffect(() => { setDraft(initialValue); }, [initialValue]);\n  return <button onClick={() => setDraft("edited")}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/local-initial-only-alias.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "separate-reset-trigger",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = (props) => {\n  const { data: sourceValue, resetNonce } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  useEffect(() => { setDraft(sourceValue); }, [sourceValue, resetNonce]);\n  return <button onClick={() => setDraft("edited")}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/separate-reset-trigger.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "mutable-selected-alias",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = (props) => {\n  let { data: sourceValue } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  sourceValue = "other";\n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft("edited")}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/mutable-selected-alias.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "reassigned-props-parameter",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = (props) => {\n  const { data: sourceValue } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  props = { data: "replacement" };\n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft("edited")}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/reassigned-props-parameter.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "selected-default-binding",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = (props) => {\n  const { data: sourceValue = "fallback" } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft("edited")}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/selected-default-binding.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "unknown-computed-selected-key",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = (props) => {\n  const field = "data"; const { [field]: sourceValue } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft("edited")}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/unknown-computed-selected-key.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "nested-selected-pattern",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = (props) => {\n  const { data: { value: sourceValue } } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft("edited")}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/nested-selected-pattern.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "intermediate-props-alias",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = (props) => {\n  const input = props; const { data: sourceValue } = input;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft("edited")}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/intermediate-props-alias.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "opaque-props-producer",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = (props) => {\n  const { data: sourceValue } = readProps(props);\n  const [draft, setDraft] = useState(sourceValue);\n  \n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft("edited")}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/opaque-props-producer.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "callback-shadows-selected-alias",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = (props) => { const {data: sourceValue} = props; const [draft,setDraft] = useState(sourceValue); useEffect((sourceValue) => {setDraft(sourceValue);}, [sourceValue]); return <span>{draft}</span>; };\n',
    options: {
      filename: "/synthetic/body-prop-origin/callback-shadows-selected-alias.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "getter-visible-contradiction",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = (props) => {\n  const { data: sourceValue } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  Object.defineProperty(props, "data", { get: () => "changed" });\n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft("edited")}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/getter-visible-contradiction.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "evaluator-visible-contradiction",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = (props) => {\n  const { data: sourceValue } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  eval("props.data = \'changed\'");\n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft("edited")}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/evaluator-visible-contradiction.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "different-setter-input",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = (props) => {\n  const { data: sourceValue } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  useEffect(() => { setDraft(props.other); }, [sourceValue]);\n  return <button onClick={() => setDraft("edited")}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/different-setter-input.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "selected-property-in-rest",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = (props) => {\n  const { label, ...sourceValue } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft("edited")}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/selected-property-in-rest.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "unrelated-computed-sibling",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = (props) => {\n  const name = "label"; const { data: sourceValue, [name]: label } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  void label;\n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft("edited")}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/unrelated-computed-sibling.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "unrelated-call-default-sibling",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = (props) => {\n  const { data: sourceValue, label = opaque() } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  void label;\n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft("edited")}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/unrelated-call-default-sibling.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "multi-declarator-opaque-sibling",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = (props) => {\n  const { data: sourceValue } = props, ignored = opaque();\n  const [draft, setDraft] = useState(sourceValue);\n  void ignored;\n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft("edited")}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/multi-declarator-opaque-sibling.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "lowercase-helper-noncomponent",
    code: 'import { useEffect, useState } from "react";\nexport const helper = (props) => {\n  const { data: sourceValue } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft("edited")}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/lowercase-helper-noncomponent.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "late-alias-declaration",
    code: 'import { useEffect, useState } from "react";\nexport const Panel = (props) => { const [draft,setDraft] = useState(sourceValue); const {data:sourceValue} = props; useEffect(()=>{setDraft(sourceValue);},[sourceValue]); return <span>{draft}</span>; };\n',
    options: {
      filename: "/synthetic/body-prop-origin/late-alias-declaration.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "direct-required-array-property",
    code: 'import { useEffect, useState } from "react";\ninterface ArrayProps { data: string[] }\nexport const Panel = (props: ArrayProps) => {\n  const { data: sourceValue } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/typed-array-direct-required-array-property.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 1,
  },
  {
    name: "three-local-path-generic-elements-opaque-width-branches",
    code: 'import { useEffect, useState } from "react";\nimport type { SpacingProps, HtmlProps, GlobalMarginProps } from "./unrelated-types";\ninterface Column { key: string }\ninterface Row<Columns extends readonly Column[]> { id: string }\ninterface BaseProps<Columns extends readonly Column[]> extends SpacingProps, HtmlProps { data: Row<Columns>[]; label?: string; loadingRowAmount?: number }\ntype HeadingProps = { caption: string } | { labelledBy: string };\ntype TableProps<Columns extends readonly Column[]> = BaseProps<Columns> & HeadingProps;\ntype InternalProps<Columns extends readonly Column[]> = TableProps<Columns> & GlobalMarginProps;\nexport const Panel = <Columns extends readonly Column[]>(props: InternalProps<Columns>) => {\n  const { data: sourceValue } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n',
    options: {
      filename:
        "/synthetic/body-prop-origin/typed-array-three-local-path-generic-elements-opaque-width-branches.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 1,
  },
  {
    name: "unrelated-default5-rest-and-default-react-readonly-api",
    code: 'import React, { useEffect, useState } from "react";\ninterface ArrayProps { data: string[]; label?: string; loadingRowAmount?: number }\nexport const Panel = (props: ArrayProps) => {\n  const { label, data: sourceValue, loadingRowAmount = 5, ...rest } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  const marker = React.createRef<HTMLDivElement>(); void React.isValidElement(null); void marker; void label; void loadingRowAmount; void rest;\n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n',
    options: {
      filename:
        "/synthetic/body-prop-origin/typed-array-unrelated-default5-rest-and-default-react-readonly-api.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 1,
  },
  {
    name: "callable-required-property",
    code: 'import { useEffect, useState } from "react";\ninterface ArrayProps { data: (previous?: number) => number }\nexport const Panel = (props: ArrayProps) => {\n  const { data: sourceValue } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft((previous) => previous + 1)}>{draft}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/typed-array-callable-required-property.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "unknown-required-property",
    code: 'import { useEffect, useState } from "react";\ninterface ArrayProps { data: unknown }\nexport const Panel = (props: ArrayProps) => {\n  const { data: sourceValue } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <span>{String(draft)}</span>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/typed-array-unknown-required-property.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "selected-array-default",
    code: 'import { useEffect, useState } from "react";\ninterface ArrayProps { data?: string[] }\nexport const Panel = (props: ArrayProps) => {\n  const { data: sourceValue = [] } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/typed-array-selected-array-default.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "array-or-callable-union-property",
    code: 'import { useEffect, useState } from "react";\ninterface ArrayProps { data: string[] | ((previous?: string[]) => string[]) }\nexport const Panel = (props: ArrayProps) => {\n  const { data: sourceValue } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/typed-array-array-or-callable-union-property.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "selected-generic-value-substitution",
    code: 'import { useEffect, useState } from "react";\ninterface ArrayProps<Value> { data: Value }\nexport const Panel = (props: ArrayProps<string[]>) => {\n  const { data: sourceValue } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/typed-array-selected-generic-value-substitution.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "visible-conflicting-intersection-property",
    code: 'import { useEffect, useState } from "react";\ninterface ArrayBase { data: string[] }\ntype ArrayProps = ArrayBase & { data: () => string[] };\nexport const Panel = (props: ArrayProps) => {\n  const { data: sourceValue } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n',
    options: {
      filename:
        "/synthetic/body-prop-origin/typed-array-visible-conflicting-intersection-property.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "optional-array-property-without-default",
    code: 'import { useEffect, useState } from "react";\ninterface ArrayProps { data?: string[] }\nexport const Panel = (props: ArrayProps) => {\n  const { data: sourceValue } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <span>{String(draft)}</span>;\n};\n',
    options: {
      filename:
        "/synthetic/body-prop-origin/typed-array-optional-array-property-without-default.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "erased-react-hook-providers",
    code: 'import type { useEffect, useState } from "react";\ninterface ArrayProps { data: string[] }\nexport const Panel = (props: ArrayProps) => {\n  const { data: sourceValue } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/typed-array-erased-react-hook-providers.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "callback-shadows-array-alias",
    code: 'import { useEffect, useState } from "react";\ninterface ArrayProps { data: string[] }\nexport const Panel = (props: ArrayProps) => {\n  const { data: sourceValue } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  useEffect((sourceValue: string[]) => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/typed-array-callback-shadows-array-alias.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "merged-local-props-interface",
    code: 'import { useEffect, useState } from "react";\ninterface ArrayProps { data: string[] }\ninterface ArrayProps { label?: string }\nexport const Panel = (props: ArrayProps) => {\n  const { data: sourceValue } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/typed-array-merged-local-props-interface.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "opaque-selected-type-reference",
    code: 'import { useEffect, useState } from "react";\nimport type { ArrayProps } from "./selected-props";\nexport const Panel = (props: ArrayProps) => {\n  const { data: sourceValue } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <span>{String(draft)}</span>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/typed-array-opaque-selected-type-reference.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "typed-initial-source-property",
    code: 'import { useEffect, useState } from "react";\ninterface ArrayProps { initialData: string[] }\nexport const Panel = (props: ArrayProps) => {\n  const { initialData: sourceValue } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/typed-array-typed-initial-source-property.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "typed-initial-local-alias",
    code: 'import { useEffect, useState } from "react";\ninterface ArrayProps { data: string[] }\nexport const Panel = (props: ArrayProps) => {\n  const { data: initialValue } = props;\n  const [draft, setDraft] = useState(initialValue);\n  \n  useEffect(() => { setDraft(initialValue); }, [initialValue]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/typed-array-typed-initial-local-alias.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "default-react-namespace-hook-provider-write",
    code: 'import React, { useEffect, useState } from "react";\nReact.useEffect = () => {};\ninterface ArrayProps { data: string[]; label?: string; loadingRowAmount?: number }\nexport const Panel = (props: ArrayProps) => {\n  const { label, data: sourceValue, loadingRowAmount = 5, ...rest } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  const marker = React.createRef<HTMLDivElement>(); void React.isValidElement(null); void marker; void label; void loadingRowAmount; void rest;\n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n',
    options: {
      filename:
        "/synthetic/body-prop-origin/typed-array-default-react-namespace-hook-provider-write.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "typed-mutable-selected-alias",
    code: 'import { useEffect, useState } from "react";\ninterface ArrayProps { data: string[] }\nexport const Panel = (props: ArrayProps) => {\n  let { data: sourceValue } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  sourceValue = [];\n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/typed-array-typed-mutable-selected-alias.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "typed-reassigned-props-parameter",
    code: 'import { useEffect, useState } from "react";\ninterface ArrayProps { data: string[] }\nexport const Panel = (props: ArrayProps) => {\n  const { data: sourceValue } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  props = { data: [] };\n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/typed-array-typed-reassigned-props-parameter.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "typed-selected-property-write",
    code: 'import { useEffect, useState } from "react";\ninterface ArrayProps { data: string[] }\nexport const Panel = (props: ArrayProps) => {\n  const { data: sourceValue } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  props.data = [];\n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/typed-array-typed-selected-property-write.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "typed-selected-array-element-write",
    code: 'import { useEffect, useState } from "react";\ninterface ArrayProps { data: string[] }\nexport const Panel = (props: ArrayProps) => {\n  const { data: sourceValue } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  sourceValue[0] = "changed";\n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/typed-array-typed-selected-array-element-write.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "typed-props-opaque-call-escape",
    code: 'import { useEffect, useState } from "react";\nimport { inspectRecord } from "./opaque-record-consumer";\ninterface ArrayProps { data: string[] }\nexport const Panel = (props: ArrayProps) => {\n  const { data: sourceValue } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  inspectRecord(props);\n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/typed-array-typed-props-opaque-call-escape.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "typed-selected-alias-transport-escape",
    code: 'import { useEffect, useState } from "react";\nimport { inspectData } from "./opaque-array-consumer";\ninterface ArrayProps { data: string[] }\nexport const Panel = (props: ArrayProps) => {\n  const { data: sourceValue } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  const transported = sourceValue; inspectData(transported);\n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/typed-array-typed-selected-alias-transport-escape.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "typed-selected-getter-reflection",
    code: 'import { useEffect, useState } from "react";\ninterface ArrayProps { data: string[] }\nexport const Panel = (props: ArrayProps) => {\n  const { data: sourceValue } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  Object.defineProperty(props, "data", { get: () => [] });\n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/typed-array-typed-selected-getter-reflection.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "typed-selected-reflect-set",
    code: 'import { useEffect, useState } from "react";\ninterface ArrayProps { data: string[] }\nexport const Panel = (props: ArrayProps) => {\n  const { data: sourceValue } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  Reflect.set(props, "data", []);\n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/typed-array-typed-selected-reflect-set.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "typed-direct-eval-admission",
    code: 'import { useEffect, useState } from "react";\ninterface ArrayProps { data: string[] }\nexport const Panel = (props: ArrayProps) => {\n  const { data: sourceValue } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  eval("props.data = []");\n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/typed-array-typed-direct-eval-admission.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "typed-reflected-constructor-admission",
    code: 'import { useEffect, useState } from "react";\ninterface ArrayProps { data: string[] }\nexport const Panel = (props: ArrayProps) => {\n  const { data: sourceValue } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  const { constructor: Build } = (() => {}); void Build("return []")();\n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/typed-array-typed-reflected-constructor-admission.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "typed-react-provider-alias-write",
    code: 'import React, { useEffect, useState } from "react";\nconst provider = React; provider.useState = () => [[], () => {}];\ninterface ArrayProps { data: string[]; label?: string; loadingRowAmount?: number }\nexport const Panel = (props: ArrayProps) => {\n  const { label, data: sourceValue, loadingRowAmount = 5, ...rest } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  const marker = React.createRef<HTMLDivElement>(); void React.isValidElement(null); void marker; void label; void loadingRowAmount; void rest;\n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/typed-array-typed-react-provider-alias-write.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "typed-react-provider-reflection-write",
    code: 'import React, { useEffect, useState } from "react";\nReflect.set(React, "useEffect", () => {});\ninterface ArrayProps { data: string[]; label?: string; loadingRowAmount?: number }\nexport const Panel = (props: ArrayProps) => {\n  const { label, data: sourceValue, loadingRowAmount = 5, ...rest } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  const marker = React.createRef<HTMLDivElement>(); void React.isValidElement(null); void marker; void label; void loadingRowAmount; void rest;\n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/typed-array-typed-react-provider-reflection-write.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "typed-extra-reset-trigger",
    code: 'import { useEffect, useState } from "react";\ninterface ArrayProps { data: string[]; resetNonce: number }\nexport const Panel = (props: ArrayProps) => {\n  const { data: sourceValue, resetNonce } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  useEffect(() => { setDraft(sourceValue); }, [sourceValue, resetNonce]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/typed-array-typed-extra-reset-trigger.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "typed-computed-selected-key",
    code: 'import { useEffect, useState } from "react";\ninterface ArrayProps { data: string[] }\nexport const Panel = (props: ArrayProps) => {\n  const field = "data"; const { [field]: sourceValue } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/typed-array-typed-computed-selected-key.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "typed-computed-unrelated-sibling",
    code: 'import { useEffect, useState } from "react";\ninterface ArrayProps { data: string[]; label?: string }\nexport const Panel = (props: ArrayProps) => {\n  const name = "label"; const { data: sourceValue, [name]: label } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  void label;\n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/typed-array-typed-computed-unrelated-sibling.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "typed-opaque-default-sibling",
    code: 'import { useEffect, useState } from "react";\ninterface ArrayProps { data: string[]; label?: string }\nimport { opaque } from "./opaque-sibling";\nexport const Panel = (props: ArrayProps) => {\n  const { data: sourceValue, label = opaque() } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  void label;\n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n',
    options: {
      filename: "/synthetic/body-prop-origin/typed-array-typed-opaque-default-sibling.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "typed-multiple-declarator-opaque-sibling",
    code: 'import { useEffect, useState } from "react";\ninterface ArrayProps { data: string[] }\nimport { opaque } from "./opaque-sibling";\nexport const Panel = (props: ArrayProps) => {\n  const { data: sourceValue } = props, ignored = opaque();\n  const [draft, setDraft] = useState(sourceValue);\n  void ignored;\n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n',
    options: {
      filename:
        "/synthetic/body-prop-origin/typed-array-typed-multiple-declarator-opaque-sibling.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "typed-late-selected-alias-declaration",
    code: 'import { useEffect, useState } from "react";\ninterface ArrayProps { data: string[] }\nexport const Panel = (props: ArrayProps) => { const [draft,setDraft] = useState(sourceValue); const {data:sourceValue} = props; useEffect(()=>{setDraft(sourceValue);},[sourceValue]); return <span>{draft}</span>; };\n',
    options: {
      filename: "/synthetic/body-prop-origin/typed-array-typed-late-selected-alias-declaration.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "react-default-direct-inherited-getter-provider-mutation",
    code: 'import React, { useEffect, useState } from "react";\nReact.__defineGetter__("useState", () => ((initialValue: string[]) => [initialValue, () => {}]));\ninterface ArrayProps { data: string[]; label?: string; loadingRowAmount?: number }\nexport const Panel = (props: ArrayProps) => {\n  const { label, data: sourceValue, loadingRowAmount = 5, ...rest } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  const marker = React.createRef<HTMLDivElement>(); void React.isValidElement(null); void marker; void label; void loadingRowAmount; void rest;\n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n',
    options: {
      filename:
        "/synthetic/body-prop-origin/react-default-direct-inherited-getter-provider-mutation.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "react-default-computed-string-inherited-getter-provider-mutation",
    code: 'import React, { useEffect, useState } from "react";\nReact["__defineGetter__"]("useState", () => ((initialValue: string[]) => [initialValue, () => {}]));\ninterface ArrayProps { data: string[]; label?: string; loadingRowAmount?: number }\nexport const Panel = (props: ArrayProps) => {\n  const { label, data: sourceValue, loadingRowAmount = 5, ...rest } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  const marker = React.createRef<HTMLDivElement>(); void React.isValidElement(null); void marker; void label; void loadingRowAmount; void rest;\n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n',
    options: {
      filename:
        "/synthetic/body-prop-origin/react-default-computed-string-inherited-getter-provider-mutation.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "react-default-direct-inherited-setter-provider-mutation",
    code: 'import React, { useEffect, useState } from "react";\nReact.__defineSetter__("useState", () => {});\ninterface ArrayProps { data: string[]; label?: string; loadingRowAmount?: number }\nexport const Panel = (props: ArrayProps) => {\n  const { label, data: sourceValue, loadingRowAmount = 5, ...rest } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  const marker = React.createRef<HTMLDivElement>(); void React.isValidElement(null); void marker; void label; void loadingRowAmount; void rest;\n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n',
    options: {
      filename:
        "/synthetic/body-prop-origin/react-default-direct-inherited-setter-provider-mutation.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 0,
  },
  {
    name: "quoted-static-unrelated-sibling-default5-rest-readonly-react",
    code: 'import React, { useEffect, useState } from "react";\ninterface ArrayProps { data: string[]; label?: string; loadingRowAmount?: number; "aria-labelledby"?: string }\nexport const Panel = (props: ArrayProps) => {\n  const { label, data: sourceValue, loadingRowAmount = 5, "aria-labelledby": ariaLabelledBy, ...rest } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  const marker = React.createRef<HTMLDivElement>(); void React.isValidElement(null); void marker; void ariaLabelledBy; void label; void loadingRowAmount; void rest;\n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n',
    options: {
      filename:
        "/synthetic/body-prop-origin/quoted-static-unrelated-sibling-default5-rest-readonly-react.tsx",
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
      includeLocations: true,
    },
    expectedDiagnostics: 1,
  },
];

describe("no-mirror-prop-effect typed body array aliases", () => {
  for (const control of controls) {
    it(control.name, () => {
      const result = runRule(noMirrorPropEffect, control.code, control.options);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(control.expectedDiagnostics);
    });
  }
});
