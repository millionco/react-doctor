export const BODY_ARRAY_COMPONENT_COUNTS = [20, 100];
export const BODY_ARRAY_REJECTED_CONTEXT_REPEAT_COUNT = 20;
export const BODY_ARRAY_MAX_AST_READS_PER_CODE_UNIT = 16;
export const BODY_ARRAY_MAX_REFERENCES_PER_COMPONENT = 16;
export const BODY_ARRAY_REFERENCE_ALLOWANCE = 40;
export const BODY_ARRAY_MAX_PROVIDER_REFERENCES_PER_COMPONENT = 4;
export const BODY_ARRAY_PROVIDER_REFERENCE_ALLOWANCE = 20;
export const BODY_ARRAY_MAX_PROGRAM_BODY_READS = 8;
export const BODY_ARRAY_NOMINAL_SOURCE =
  'import { useEffect, useState } from "react";\ninterface ArrayProps { data: string[] }\nexport const Panel = (props: ArrayProps) => {\n  const { data: sourceValue } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n';
export const BODY_ARRAY_CONTEXT_SOURCE =
  'import { useEffect, useState } from "react";\ninterface ArrayProps { data: string[]; resetNonce: number }\nexport const PanelGood = (props: ArrayProps) => {\n  const { data: sourceValue } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  useEffect(() => { setDraft(sourceValue); }, [sourceValue]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\nexport const PanelBad = (props: ArrayProps) => {\n  const { data: sourceValue, resetNonce } = props;\n  const [draft, setDraft] = useState(sourceValue);\n  \n  useEffect(() => { setDraft(sourceValue); }, [sourceValue, resetNonce]);\n  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;\n};\n';
export const BODY_ARRAY_RULE_OPTIONS = {
  settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
};
