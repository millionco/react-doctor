import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRefCallbackCleanupBeforeReact19 } from "./no-ref-callback-cleanup-before-react-19.js";

interface GuardedMapProofCase {
  name: string;
  code: string;
  expected: number;
}

const cases: ReadonlyArray<GuardedMapProofCase> = [
  {
    name: "baseline-closed-effect-selector",
    expected: 0,
    code: 'import * as React from "react";\nconst useBrowserEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  useBrowserEffect(() => { entries.current.get(entryKey)?.focus(); }, [entryKey]);\n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
  },
  {
    name: "erased-window-interface",
    expected: 0,
    code: 'import * as React from "react";\ninterface window {}\nconst useBrowserEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  useBrowserEffect(() => { entries.current.get(entryKey)?.focus(); }, [entryKey]);\n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
  },
  {
    name: "erased-window-type-alias",
    expected: 0,
    code: 'import * as React from "react";\ntype window = unknown;\nconst useBrowserEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  useBrowserEffect(() => { entries.current.get(entryKey)?.focus(); }, [entryKey]);\n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
  },
  {
    name: "genuine-local-window",
    expected: 1,
    code: 'import * as React from "react";\nconst window = {};\nconst useBrowserEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  useBrowserEffect(() => { entries.current.get(entryKey)?.focus(); }, [entryKey]);\n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
  },
  {
    name: "genuine-local-window-merged-interface",
    expected: 1,
    code: 'import * as React from "react";\nconst window = {}; interface window {}\nconst useBrowserEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  useBrowserEffect(() => { entries.current.get(entryKey)?.focus(); }, [entryKey]);\n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
  },
  {
    name: "merged-react-namespace-interface",
    expected: 0,
    code: 'import * as React from "react";\ninterface React {}\nconst useBrowserEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  useBrowserEffect(() => { entries.current.get(entryKey)?.focus(); }, [entryKey]);\n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
  },
  {
    name: "merged-selector-const-interface",
    expected: 0,
    code: 'import * as React from "react";\ninterface useBrowserEffect {}\nconst useBrowserEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  useBrowserEffect(() => { entries.current.get(entryKey)?.focus(); }, [entryKey]);\n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
  },
  {
    name: "guarded-key-container-effect-mutation",
    expected: 1,
    code: 'import * as React from "react";\n\nconst changeKey = (target: { id: string }) => { target.id = "second"; };\nexport const EntryPanel = ({ record }: { record: { id: string } }) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  \n  \n  React.useEffect(() => { changeKey(record); }, []);\n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(record.id, element);\n      return () => {\n        if (entries.current.get(record.id) === element) entries.current.delete(record.id);\n      };\n    } else {\n      entries.current.delete(record.id);\n    }\n  }}>Entry</li>;\n};\n',
  },
  {
    name: "guarded-selected-leaf-readonly-observation",
    expected: 0,
    code: 'import * as React from "react";\n\nexport const EntryPanel = ({ record }: { record: { id: string } }) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  \n  \n  React.useEffect(() => { inspect(record.id); }, []);\n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(record.id, element);\n      return () => {\n        if (entries.current.get(record.id) === element) entries.current.delete(record.id);\n      };\n    } else {\n      entries.current.delete(record.id);\n    }\n  }}>Entry</li>;\n};\n',
  },
  {
    name: "guarded-unrelated-branch-readonly-observation",
    expected: 0,
    code: 'import * as React from "react";\n\nexport const EntryPanel = ({ record }: { record: { id: string } }) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  \n  \n  React.useEffect(() => { inspect(record.other); }, []);\n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(record.id, element);\n      return () => {\n        if (entries.current.get(record.id) === element) entries.current.delete(record.id);\n      };\n    } else {\n      entries.current.delete(record.id);\n    }\n  }}>Entry</li>;\n};\n',
  },
  {
    name: "optional-selected-leaf-observation",
    code: 'import * as React from "react";\ninterface Entry { id: string; }\ninterface PanelProps { item: Entry; onSelect?: (id: string) => void; }\nexport const EntryPanel = ({ item, onSelect }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const renderEntry = (record: Entry) => <li ref={(element) => {\n    if (element) {\n      entries.current.set(record.id, element);\n      return () => { if (entries.current.get(record.id) === element) entries.current.delete(record.id); };\n    } else entries.current.delete(record.id);\n  }} onClick={() => onSelect?.(record.id)}>Entry</li>;\n  return <ul>{renderEntry(item)}</ul>;\n};\n',
    expected: 0,
  },
];

describe("guarded callback Map provider and key boundaries", () => {
  it.each(cases)("$name", ({ name, code, expected }) => {
    const result = runRule(noRefCallbackCleanupBeforeReact19, code, {
      filename: `/synthetic/guarded-map-proof/${name}.tsx`,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
