import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";

interface ControllerRecordReviewCase {
  name: string;
  prefix: string;
  mergedRegistry: boolean;
  expected: number;
}

const fixtureImport = 'import { useCallback, useEffect, useRef, useState } from "react";';
const fixtureBody =
  'interface PanelProps { category: string; }\ninterface RequestEntry { controller: AbortController; attempt: number; }\nconst requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";\nexport const ResourcePanel = ({ category }: PanelProps) => {\n  const requests = useRef<Map<string, RequestEntry>>(new Map());\n  const counter = useRef(0);\n  const [busy, setBusy] = useState<Set<string>>(new Set());\n  const stopAll = useCallback(() => {\n    if (requests.current.size === 0) return;\n    requests.current.forEach(({ controller }) => controller.abort());\n    requests.current.clear();\n    setBusy(new Set());\n  }, []);\n  useEffect(() => { stopAll(); }, [category, stopAll]);\n  useEffect(() => stopAll, [stopAll]);\n  const start = async (resourceKey: string) => {\n    if (requests.current.has(resourceKey)) return;\n    const controller = new AbortController();\n    const attempt = ++counter.current;\n    requests.current.set(resourceKey, { controller, attempt });\n    setBusy(previous => new Set(previous).add(resourceKey));\n    try {\n      await requestResource(controller.signal);\n      if (requests.current.get(resourceKey)?.attempt !== attempt) return;\n    } catch {\n      if (requests.current.get(resourceKey)?.attempt !== attempt) return;\n    } finally {\n      const active = requests.current.get(resourceKey);\n      if (active?.attempt === attempt) {\n        requests.current.delete(resourceKey);\n        setBusy(previous => { const next = new Set(previous); next.delete(resourceKey); return next; });\n      }\n    }\n  };\n  return <button onClick={() => { void start("entry"); }}>{busy.has("entry") ? "Working" : "Start"}</button>;\n};\n';
const cases: ControllerRecordReviewCase[] = [
  { name: "baseline", prefix: "", mergedRegistry: false, expected: 0 },
  {
    name: "erased-interface-map",
    prefix: "interface Map<Key, Value> extends globalThis.Map<Key, Value> {}",
    mergedRegistry: false,
    expected: 0,
  },
  {
    name: "erased-interface-set",
    prefix: "interface Set<Value> extends globalThis.Set<Value> {}",
    mergedRegistry: false,
    expected: 0,
  },
  {
    name: "react-loader-replacement",
    prefix: 'const loadedReact = require("react"); loadedReact.useState = selectState;',
    mergedRegistry: false,
    expected: 1,
  },
  {
    name: "react-default-loader-replacement",
    prefix: 'const loadedReact = require("react"); loadedReact.default.useState = selectState;',
    mergedRegistry: false,
    expected: 1,
  },
  { name: "merged-readonly-registry-interface", prefix: "", mergedRegistry: true, expected: 0 },
  {
    name: "foreign-module-provider-write",
    prefix: 'const loadedReact = require("unrelated"); loadedReact.useState = selectState;',
    mergedRegistry: false,
    expected: 0,
  },
  {
    name: "harmless-react-module-read",
    prefix: 'const loadedReact = require("react"); void loadedReact.version;',
    mergedRegistry: false,
    expected: 0,
  },
  {
    name: "unrelated-react-module-member-write",
    prefix: 'const loadedReact = require("react"); loadedReact.unrelated = selectState;',
    mergedRegistry: false,
    expected: 0,
  },
  {
    name: "real-local-loader-provider-write",
    prefix:
      'const require = (_source: string) => ({ useState: () => null }); const loadedReact = require("react"); loadedReact.useState = () => null;',
    mergedRegistry: false,
    expected: 0,
  },
  {
    name: "deleted-loaded-react-api",
    prefix: 'const loadedReact = require("react"); delete loadedReact.useState;',
    mergedRegistry: false,
    expected: 1,
  },
  {
    name: "destructured-loaded-react-api-write",
    prefix:
      'const loadedReact = require("react"); ({ useState: loadedReact.useState } = replacement);',
    mergedRegistry: false,
    expected: 1,
  },
  {
    name: "loaded-react-api-computed-index-read",
    prefix:
      'const loadedReact = require("react"); const values = {}; values[loadedReact.useState] = replacement;',
    mergedRegistry: false,
    expected: 0,
  },
];

describe("owned controller record runtime provider proof", () => {
  it.each(cases)("$name", ({ prefix, mergedRegistry, expected }) => {
    const body = mergedRegistry
      ? fixtureBody.replace(
          "  const counter = useRef(0);",
          "  interface requests {}\n  const counter = useRef(0);",
        )
      : fixtureBody;
    const source = [fixtureImport, prefix, body].join("\n");
    const result = runRule(noAdjustStateOnPropChange, source, {
      filename: "/synthetic/controller-record-review.tsx",
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
