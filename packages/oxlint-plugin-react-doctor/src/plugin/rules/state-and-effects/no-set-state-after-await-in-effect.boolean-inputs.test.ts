import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSetStateAfterAwaitInEffect } from "./no-set-state-after-await-in-effect.js";

interface EffectCallbackBooleanInputCase {
  name: string;
  code: string;
  expected: number;
  options: {
    filename: string;
    forceJsx: boolean;
    includeLocations: boolean;
    settings: { "react-doctor": { portedRuleMode: "curated"; capabilities: string[] } };
  };
}

const cases: ReadonlyArray<EffectCallbackBooleanInputCase> = [
  {
    name: "direct-native-focus-call",
    code: 'import { useCallback, useEffect, useState } from "react";\n\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { await Promise.resolve(query); setValue(query); }, [query]);\n  useEffect(() => { if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 1,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "parenthesized-native-focus-call",
    code: 'import { useCallback, useEffect, useState } from "react";\n\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { await Promise.resolve(query); setValue(query); }, [query]);\n  useEffect(() => { if ((document.hasFocus())) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 1,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "negated-native-focus-call",
    code: 'import { useCallback, useEffect, useState } from "react";\n\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { await Promise.resolve(query); setValue(query); }, [query]);\n  useEffect(() => { if (!document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 1,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "alternate-native-focus-branch",
    code: 'import { useCallback, useEffect, useState } from "react";\n\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { await Promise.resolve(query); setValue(query); }, [query]);\n  useEffect(() => { if (document.hasFocus()) { return; } else { run(); } }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 1,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "computed-focus-member-declined",
    code: 'import { useCallback, useEffect, useState } from "react";\n\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { await Promise.resolve(query); setValue(query); }, [query]);\n  useEffect(() => { if (document["hasFocus"]()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "optional-focus-call-declined",
    code: 'import { useCallback, useEffect, useState } from "react";\n\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { await Promise.resolve(query); setValue(query); }, [query]);\n  useEffect(() => { if (document.hasFocus?.()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "focus-call-with-argument-declined",
    code: 'import { useCallback, useEffect, useState } from "react";\n\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { await Promise.resolve(query); setValue(query); }, [query]);\n  useEffect(() => { if (document.hasFocus(query)) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "shadowed-document-declined",
    code: 'import { useCallback, useEffect, useState } from "react";\n\nexport const FocusPanel = ({ query, document }: { query: string; document: { hasFocus: () => boolean } }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { await Promise.resolve(query); setValue(query); }, [query]);\n  useEffect(() => { if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "visible-focus-method-replacement",
    code: 'import { useCallback, useEffect, useState } from "react";\ndocument.hasFocus = () => false;\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { await Promise.resolve(query); setValue(query); }, [query]);\n  useEffect(() => { if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "document-transport-declined",
    code: 'import { useCallback, useEffect, useState } from "react";\nconst publish = (received: Document) => received; publish(document);\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { await Promise.resolve(query); setValue(query); }, [query]);\n  useEffect(() => { if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "qualified-global-document-replacement",
    code: 'import { useCallback, useEffect, useState } from "react";\nwindow.document.hasFocus = () => false;\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { await Promise.resolve(query); setValue(query); }, [query]);\n  useEffect(() => { if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "document-prototype-replacement",
    code: 'import { useCallback, useEffect, useState } from "react";\nDocument.prototype.hasFocus = () => false;\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { await Promise.resolve(query); setValue(query); }, [query]);\n  useEffect(() => { if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "reflective-provider-replacement",
    code: 'import { useCallback, useEffect, useState } from "react";\nReflect.set(document, "hasFocus", () => false);\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { await Promise.resolve(query); setValue(query); }, [query]);\n  useEffect(() => { if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "direct-global-eval-declined",
    code: 'import { useCallback, useEffect, useState } from "react";\neval("document.hasFocus = () => false");\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { await Promise.resolve(query); setValue(query); }, [query]);\n  useEffect(() => { if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "erased-eval-mask-declined",
    code: 'import { useCallback, useEffect, useState } from "react";\ninterface eval {}\neval("document.hasFocus = () => false");\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { await Promise.resolve(query); setValue(query); }, [query]);\n  useEffect(() => { if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "ambient-eval-mask-declined",
    code: 'import { useCallback, useEffect, useState } from "react";\ndeclare const eval: (source: string) => unknown;\neval("document.hasFocus = () => false");\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { await Promise.resolve(query); setValue(query); }, [query]);\n  useEffect(() => { if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "runtime-typescript-declined",
    code: 'import { useCallback, useEffect, useState } from "react";\nenum NativeMode { First }\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { await Promise.resolve(query); setValue(query); }, [query]);\n  useEffect(() => { if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "nested-erased-document-write-declined",
    code: 'import { useCallback, useEffect, useState } from "react";\nconst changeProvider = () => { interface document {} document.hasFocus = () => false; }; changeProvider();\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { await Promise.resolve(query); setValue(query); }, [query]);\n  useEffect(() => { if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "arbitrary-predicate-call-declined",
    code: 'import { useCallback, useEffect, useState } from "react";\n\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  const isSelected = () => false;\n  const run = useCallback(async () => { await Promise.resolve(query); setValue(query); }, [query]);\n  useEffect(() => { if (isSelected()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "literal-false-branch-quiet",
    code: 'import { useCallback, useEffect, useState } from "react";\n\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { await Promise.resolve(query); setValue(query); }, [query]);\n  useEffect(() => { if (false) { if (document.hasFocus()) run(); } }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "literal-truthy-alternate-quiet",
    code: 'import { useCallback, useEffect, useState } from "react";\n\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { await Promise.resolve(query); setValue(query); }, [query]);\n  useEffect(() => { if ("present") { return; } else { if (document.hasFocus()) run(); } }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "unconditional-return-before-launch-quiet",
    code: 'import { useCallback, useEffect, useState } from "react";\n\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { await Promise.resolve(query); setValue(query); }, [query]);\n  useEffect(() => { return; if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "memoized-callback-not-launched-quiet",
    code: 'import { useCallback, useEffect, useState } from "react";\n\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { await Promise.resolve(query); setValue(query); }, [query]);\n  useEffect(() => { if (document.hasFocus()) { void run; } }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "external-event-registration-only-quiet",
    code: 'import { useCallback, useEffect, useState } from "react";\n\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { await Promise.resolve(query); setValue(query); }, [query]);\n  useEffect(() => { window.addEventListener("focus", run); return () => window.removeEventListener("focus", run); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "stable-empty-dependency-control",
    code: 'import { useCallback, useEffect, useState } from "react";\n\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { await Promise.resolve(query); setValue(query); }, []);\n  useEffect(() => { if (document.hasFocus()) run(); }, [run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "existing-local-ignore-guard-quiet",
    code: 'import { useEffect, useState } from "react";\nexport const GuardedPanel = ({ query }: { query: string }) => {\n const [value, setValue] = useState("");\n useEffect(() => { let cancelled = false; const run = async () => { await Promise.resolve(query); if (!cancelled) setValue(query); }; if (document.hasFocus()) run(); return () => { cancelled = true; }; }, [query]);\n return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "existing-plain-async-helper-positive",
    code: 'import { useEffect, useState } from "react";\nexport const GuardedPanel = ({ query }: { query: string }) => {\n const [value, setValue] = useState("");\n useEffect(() => { const run = async () => { await Promise.resolve(query); setValue(query); }; if (document.hasFocus()) run(); }, [query]);\n return <output>{value}</output>;\n};\n',
    expected: 1,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "mutable-memoized-callback-reassigned",
    code: 'import { useCallback, useEffect, useState } from "react";\n\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  \n  let run = useCallback(async () => { await Promise.resolve(query); setValue(query); }, [query]);\n  useEffect(() => { run = async () => {}; if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "react-namespace-provider-replacement",
    code: 'import { useCallback, useEffect, useState } from "react";\nimport * as React from "react"; React.useCallback = ((received: unknown) => received) as typeof React.useCallback;\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { await Promise.resolve(query); setValue(query); }, [query]);\n  useEffect(() => { if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "selected-setter-binding-reassigned",
    code: 'import { useCallback, useEffect, useState } from "react";\n\nexport const FocusPanel = ({ query }: { query: string }) => {\n  let [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { await Promise.resolve(query); setValue(query); }, [query]);\n  setValue = () => {};\n  useEffect(() => { if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "readonly-actual-awaited-result-guard",
    code: 'import { useCallback, useEffect, useState } from "react";\n\nexport const FocusPanel = ({ query, readValue }: { query: string; readValue: (query: string) => Promise<string> }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { const received = await readValue(query); if (!received) return; setValue(received); }, [query]);\n  useEffect(() => { if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 1,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "readonly-awaited-result-negative-branch",
    code: 'import { useCallback, useEffect, useState } from "react";\n\nexport const FocusPanel = ({ query, readValue }: { query: string; readValue: (query: string) => Promise<string> }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { const received = await readValue(query); if (!received) setValue("empty"); }, [query]);\n  useEffect(() => { if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 1,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "known-constant-truthiness-not-unknown",
    code: 'import { useCallback, useEffect, useState } from "react";\n\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { const received = true; if (!received) { await Promise.resolve(query); setValue(query); } }, [query]);\n  useEffect(() => { if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "visible-native-promise-rejection-quiet",
    code: 'import { useCallback, useEffect, useState } from "react";\n\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { const received = await Promise.reject(query); if (!received) setValue(query); }, [query]);\n  useEffect(() => { if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "unawaited-call-result-declined",
    code: 'import { useCallback, useEffect, useState } from "react";\n\nexport const FocusPanel = ({ query, readValue }: { query: string; readValue: (query: string) => Promise<string> }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { const received = readValue(query); if (!received) { await Promise.resolve(query); setValue(query); } }, [query]);\n  useEffect(() => { if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "awaited-result-binding-written-declined",
    code: 'import { useCallback, useEffect, useState } from "react";\n\nexport const FocusPanel = ({ query, readValue }: { query: string; readValue: (query: string) => Promise<string> }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { let received = await readValue(query); received = ""; if (received) setValue(received); }, [query]);\n  useEffect(() => { if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "awaited-result-alias-declined",
    code: 'import { useCallback, useEffect, useState } from "react";\n\nexport const FocusPanel = ({ query, readValue }: { query: string; readValue: (query: string) => Promise<string> }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { const received = await readValue(query); const selected = received; if (selected) setValue(selected); }, [query]);\n  useEffect(() => { if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "ambient-document-value-declined",
    code: 'import { useCallback, useEffect, useState } from "react";\ndeclare const document: Document;\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { await Promise.resolve(query); setValue(query); }, [query]);\n  useEffect(() => { if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "ordinary-extra-document-read-conservative-quiet",
    code: 'import { useCallback, useEffect, useState } from "react";\n\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  const title = document.title; void title;\n  const run = useCallback(async () => { await Promise.resolve(query); setValue(query); }, [query]);\n  useEffect(() => { if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "combined-ordinary-focus-and-awaited-result-shape",
    code: 'import { useCallback, useEffect, useState } from "react";\nimport { readValue } from "./value-provider.js";\nconst noop = () => {};\nexport const FocusPanel = ({ query }: { query: string }) => {\n const supported = Boolean(window.PublicKeyCredential);\n const [value, setValue] = useState("");\n const run = useCallback(async () => { try { const received = await readValue(query); setValue(received); if (!received) { setValue("empty"); return; } setValue("ready"); } catch { setValue("error"); } }, [query]);\n useEffect(() => { if (!supported) return noop; if (document.hasFocus()) { run(); return noop; } window.addEventListener("focus", run, { once: true }); return () => window.removeEventListener("focus", run); }, [supported, run]);\n return <output>{value}</output>;\n};\n',
    expected: 1,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "native-focus-impossible-nonboolean-comparison",
    code: 'import { useCallback, useEffect, useState } from "react";\n\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { await Promise.resolve(query); setValue(query); }, [query]);\n  useEffect(() => { if (document.hasFocus() === 2) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "opaque-awaited-input-void-is-not-toboolean",
    code: 'import { useCallback, useEffect, useState } from "react";\n\nexport const FocusPanel = ({ query, readValue }: { query: string; readValue: (query: string) => Promise<string> }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { const received = await readValue(query); if (void received) setValue("empty"); }, [query]);\n  useEffect(() => { if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "opaque-awaited-input-under-existing-parameter-branch",
    code: 'import { useCallback, useEffect, useState } from "react";\n\nexport const FocusPanel = ({ query, readValue }: { query: string; readValue: (query: string) => Promise<string> }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { const received = await readValue(query); if (!received) setValue("empty"); }, [query]);\n  useEffect(() => { if (query) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 1,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "known-local-awaited-producer-declined",
    code: 'import { useCallback, useEffect, useState } from "react";\n\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  \n  const readValue = async (_query: string) => "present";\n  const run = useCallback(async () => { const received = await readValue(query); if (!received) setValue("empty"); }, [query]);\n  useEffect(() => { if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "native-promise-resolve-result-declined",
    code: 'import { useCallback, useEffect, useState } from "react";\n\nexport const FocusPanel = ({ query, readValue }: { query: string; readValue: (query: string) => Promise<string> }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { const received = await Promise.resolve("present"); if (!received) setValue("empty"); }, [query]);\n  useEffect(() => { if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "member-awaited-producer-declined",
    code: 'import { useCallback, useEffect, useState } from "react";\n\nexport const FocusPanel = ({ query, provider }: { query: string; provider: { readValue: (query: string) => Promise<string> } }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { const received = await provider.readValue(query); if (!received) setValue("empty"); }, [query]);\n  useEffect(() => { if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "named-producer-alias-declined",
    code: 'import { useCallback, useEffect, useState } from "react";\nimport { readValue } from "./value-provider.js";\n\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  \n  const readAlias = readValue;\n  const run = useCallback(async () => { const received = await readAlias(query); if (!received) setValue("empty"); }, [query]);\n  useEffect(() => { if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "type-only-producer-declined",
    code: 'import { useCallback, useEffect, useState } from "react";\nimport type { readValue } from "./value-provider.js";\n\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { const received = await readValue(query); if (!received) setValue("empty"); }, [query]);\n  useEffect(() => { if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "optional-awaited-producer-call-declined",
    code: 'import { useCallback, useEffect, useState } from "react";\nimport { readValue } from "./value-provider.js";\n\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { const received = await readValue?.(query); if (!received) setValue("empty"); }, [query]);\n  useEffect(() => { if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "same-request-secondary-namespace-producer-escape",
    code: 'import { useCallback, useEffect, useState } from "react";\nimport { readValue } from "./value-provider.js";\nimport * as ValueProvider from "./value-provider.js";\nconst inspect = (_value: unknown) => {}; inspect(ValueProvider);\n\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { const received = await readValue(query); if (!received) setValue("empty"); }, [query]);\n  useEffect(() => { if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "global-object-alias-declined",
    code: 'import { useCallback, useEffect, useState } from "react";\n\nconst browser = window; void browser;\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { await Promise.resolve(query); setValue(query); }, [query]);\n  useEffect(() => { if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "unknown-computed-function-carrier-declined",
    code: 'import { useCallback, useEffect, useState } from "react";\n\nconst create = () => {}; const key = String(Math.random()); const carrier = create[key]; void carrier;\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { await Promise.resolve(query); setValue(query); }, [query]);\n  useEffect(() => { if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "named-default-secondary-react-provider-declined",
    code: 'import { useCallback, useEffect, useState } from "react";\nimport { default as ReactProvider } from "react";\nconst inspect = (_value: unknown) => {}; inspect(ReactProvider);\n\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { await Promise.resolve(query); setValue(query); }, [query]);\n  useEffect(() => { if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "selected-import-producer-member-write-declined",
    code: 'import { useCallback, useEffect, useState } from "react";\nimport { readValue } from "./value-provider.js";\n\nreadValue.extra = true;\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { const received = await readValue(query); if (!received) setValue("empty"); }, [query]);\n  useEffect(() => { if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "readonly-producer-in-genuine-callback-dependency-metadata",
    code: 'import { useCallback, useEffect, useState } from "react";\n\nexport const FocusPanel = ({ query, readValue }: { query: string; readValue: (query: string) => Promise<string> }) => {\n  const [value, setValue] = useState("");\n  \n  const run = useCallback(async () => { const received = await readValue(query); if (!received) setValue("empty"); }, [query, readValue]);\n  useEffect(() => { if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 1,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "unknown-computed-call-through-two-readonly-aliases",
    code: 'import { useCallback, useEffect, useState } from "react";\n\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  const registry = { action: () => undefined };\n  const first = registry[query];\n  const second = first;\n  second();\n  \n  const run = useCallback(async () => { await Promise.resolve(query); setValue(query); }, [query]);\n  useEffect(() => { if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "unknown-computed-direct-constructor",
    code: 'import { useCallback, useEffect, useState } from "react";\n\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  const registry = { Item: class Item {} };\n  new (registry[query])();\n  \n  const run = useCallback(async () => { await Promise.resolve(query); setValue(query); }, [query]);\n  useEffect(() => { if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "unknown-computed-constructor-through-readonly-binding",
    code: 'import { useCallback, useEffect, useState } from "react";\n\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  const registry = { Item: class Item {} };\n  const Constructor = registry[query];\n  new Constructor();\n  \n  const run = useCallback(async () => { await Promise.resolve(query); setValue(query); }, [query]);\n  useEffect(() => { if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "unknown-computed-member-receiver-through-two-aliases",
    code: 'import { useCallback, useEffect, useState } from "react";\n\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  const registry = { action: () => undefined };\n  const first = registry[query];\n  const second = first;\n  second.call(null);\n  \n  const run = useCallback(async () => { await Promise.resolve(query); setValue(query); }, [query]);\n  useEffect(() => { if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "unknown-computed-logical-conditional-carrier-to-call",
    code: 'import { useCallback, useEffect, useState } from "react";\n\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  const registry = { action: () => undefined };\n  const fallback = () => undefined;\n  const selected = registry[query] || fallback;\n  const first = query ? selected : fallback;\n  const second = first;\n  second();\n  \n  const run = useCallback(async () => { await Promise.resolve(query); setValue(query); }, [query]);\n  useEffect(() => { if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 0,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "ordinary-computed-data-through-readonly-aliases-retained",
    code: 'import { useCallback, useEffect, useState } from "react";\n\nexport const FocusPanel = ({ query }: { query: string }) => {\n  const [value, setValue] = useState("");\n  const errorLabels = { error: "Message" };\n  const first = errorLabels[query];\n  const second = first;\n  void second;\n  \n  const run = useCallback(async () => { await Promise.resolve(query); setValue(query); }, [query]);\n  useEffect(() => { if (document.hasFocus()) run(); }, [query, run]);\n  return <output>{value}</output>;\n};\n',
    expected: 1,
    options: {
      filename: "src/components/focus-predicate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
];

describe("finite effect callback boolean inputs", () => {
  it.each(cases)("$name", ({ code, expected, options }) => {
    const result = runRule(noSetStateAfterAwaitInEffect, code, options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
