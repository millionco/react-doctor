import { describe, expect, it } from "vite-plus/test";
import type { RunRuleOptions } from "../../../test-utils/run-rule.js";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRefCallbackCleanupBeforeReact19 } from "./no-ref-callback-cleanup-before-react-19.js";

interface SnapshotCase {
  name: string;
  code: string;
  effectiveOptions: RunRuleOptions;
  expected: number;
}

const cases: readonly SnapshotCase[] = [
  {
    name: "a-readonly-callback-local-map-snapshot",
    code: 'import * as React from "react";\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  \n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(entryKey, element);\n    else snapshot.delete(entryKey);\n    return () => { snapshot.delete(entryKey); };\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/case-00.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "a-readonly-external-property-key-and-native-observer",
    code: 'import * as React from "react";\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const item = { id: "card" };\n  React.useEffect(() => { entries.current.get(item.id)?.focus(); }, [item.id]);\n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(item.id, element);\n    else snapshot.delete(item.id);\n    return () => { snapshot.delete(item.id); };\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/case-01.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "a-missing-null-deletion",
    code: 'import * as React from "react";\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  \n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(entryKey, element);\n    return () => { snapshot.delete(entryKey); };\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/case-02.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "a-different-null-key",
    code: 'import * as React from "react";\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  \n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(entryKey, element);\n    else snapshot.delete("other");\n    return () => { snapshot.delete(entryKey); };\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/case-03.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "a-late-current-mixed-with-snapshot",
    code: 'import * as React from "react";\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  \n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(entryKey, element);\n    else entries.current.delete(entryKey);\n    return () => { snapshot.delete(entryKey); };\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/case-04.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "a-mutable-snapshot-binding",
    code: 'import * as React from "react";\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  \n  return <li ref={(element) => {\n    let snapshot = entries.current;\n    if (element) snapshot.set(entryKey, element);\n    else snapshot.delete(entryKey);\n    return () => { snapshot.delete(entryKey); };\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/case-05.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "a-selected-current-replacement",
    code: 'import * as React from "react";\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  entries.current = new Map();\n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(entryKey, element);\n    else snapshot.delete(entryKey);\n    return () => { snapshot.delete(entryKey); };\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/case-06.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "a-whole-map-transport",
    code: 'import * as React from "react";\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  onInspect?.(entries.current);\n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(entryKey, element);\n    else snapshot.delete(entryKey);\n    return () => { snapshot.delete(entryKey); };\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/case-07.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "a-visible-delete-method-replacement",
    code: 'import * as React from "react";\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  entries.current.delete = () => false;\n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(entryKey, element);\n    else snapshot.delete(entryKey);\n    return () => { snapshot.delete(entryKey); };\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/case-08.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "a-null-input-as-entry-key",
    code: 'import * as React from "react";\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  \n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(element, element);\n    else snapshot.delete(element);\n    return () => { snapshot.delete(element); };\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/case-09.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "b-attach-branch-identity-guarded-return",
    code: 'import * as React from "react";\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  \n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/case-10.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "b-nested-renderer-readonly-property-input",
    code: 'import * as React from "react";\ninterface Entry { id: string; }\ninterface PanelProps { item: Entry; onSelect?: (item: Entry) => void; }\nexport const EntryPanel = ({ item, onSelect }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const renderEntry = (record: Entry) => <li ref={(element) => {\n    if (element) {\n      entries.current.set(record.id, element);\n      return () => { if (entries.current.get(record.id) === element) entries.current.delete(record.id); };\n    } else entries.current.delete(record.id);\n  }} onClick={() => onSelect?.(record)}>Entry</li>;\n  return <ul>{renderEntry(item)}</ul>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/case-11.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "b-different-returned-guard-key",
    code: 'import * as React from "react";\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  \n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get("other") === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/case-12.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "b-different-returned-guard-value",
    code: 'import * as React from "react";\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  \n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === null) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/case-13.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "b-inverted-identity-guard",
    code: 'import * as React from "react";\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  \n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) !== element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/case-14.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "b-missing-null-action",
    code: 'import * as React from "react";\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  \n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/case-15.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "b-conditional-null-action",
    code: 'import * as React from "react";\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  \n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      if (entryKey === "other") entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/case-16.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "b-extra-returned-operation",
    code: 'import * as React from "react";\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  \n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n        onInspect?.(element);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/case-17.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "b-opaque-trailing-jsx-spread",
    code: 'import * as React from "react";\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  \n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }} {...attributes}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/case-18.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "b-custom-component-ref",
    code: 'import * as React from "react";\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  \n  return <CustomEntry ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</CustomEntry>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/case-19.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "a-visible-key-property-write",
    code: 'import * as React from "react";\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const item = { id: "card" };\n  item.id = "changed";\n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(item.id, element);\n    else snapshot.delete(item.id);\n    return () => { snapshot.delete(item.id); };\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/case-20.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "b-react-provider-transport",
    code: 'import * as React from "react";\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  onInspect?.(React);\n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/case-21.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "a-erased-runtime-ref-writer",
    code: 'import * as React from "react";\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  const replace = () => { interface entries {} entries.current = new Map(); }; replace();\n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(entryKey, element);\n    else snapshot.delete(entryKey);\n    return () => { snapshot.delete(entryKey); };\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/case-22.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "b-combined-snapshot-guarded-return-not-v1",
    code: 'import * as React from "react";\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  \n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) {\n      snapshot.set(entryKey, element);\n      return () => {\n        if (snapshot.get(entryKey) === element) snapshot.delete(entryKey);\n      };\n    } else {\n      snapshot.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/case-23.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "visible-selected-key-accessor",
    code: 'import * as React from "react";\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  let sequence = 0; const item = { get id() { sequence += 1; return String(sequence); } };\n  React.useEffect(() => { entries.current.get(item.id)?.focus(); }, [item.id]);\n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(item.id, element);\n    else snapshot.delete(item.id);\n    return () => { snapshot.delete(item.id); };\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/case-24.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "visible-direct-alias-key-write",
    code: 'import * as React from "react";\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const item = { id: "card" }; const alias = item; const change = () => { alias.id = "other"; };\n  React.useEffect(() => { entries.current.get(item.id)?.focus(); }, [item.id]);\n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(item.id, element);\n    else snapshot.delete(item.id);\n    return () => { snapshot.delete(item.id); };\n  }} onClick={change}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/case-25.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "nested-render-helper-snapshot-and-opaque-key-input",
    code: 'import * as React from "react";\ninterface Entry { id: string; }\ninterface Props { entry: Entry; onSelect: (value: Entry) => void; }\nexport const NestedEntries = ({ entry, onSelect }: Props) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const renderEntry = (record: Entry) => <li onClick={() => onSelect(record)} ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(record.id, element); else snapshot.delete(record.id);\n    return () => { snapshot.delete(record.id); };\n  }}>Entry</li>;\n  return <ul>{renderEntry(entry)}</ul>;\n};',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/case-26.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "react-provider-visible-transport",
    code: 'import * as React from "react";\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  \n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(entryKey, element);\n    else snapshot.delete(entryKey);\n    onInspect?.(React);\n  return () => { snapshot.delete(entryKey); };\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/case-27.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "shadowed-native-map-allocation",
    code: 'import * as React from "react";\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const Map = class { set() {} delete() {} }; const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  \n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(entryKey, element);\n    else snapshot.delete(entryKey);\n    return () => { snapshot.delete(entryKey); };\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/case-28.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "selected-ref-object-alias-transport",
    code: 'import * as React from "react";\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  onInspect?.(entries); const entryKey = "card";\n  \n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(entryKey, element);\n    else snapshot.delete(entryKey);\n    return () => { snapshot.delete(entryKey); };\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/case-29.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "module-shared-map-ref",
    code: 'import * as React from "react";\nconst entries = React.useRef(new Map<string, HTMLLIElement>());\nexport const SharedEntries = () => { const entryKey = "card"; return <li ref={(element) => {\nconst snapshot = entries.current; if (element) snapshot.set(entryKey, element); else snapshot.delete(entryKey); return () => { snapshot.delete(entryKey); }; }} />; };',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/case-30.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "snapshot-extra-operation",
    code: 'import * as React from "react";\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  \n  return <li ref={(element) => {\n    const snapshot = entries.current; onInspect?.(element);\n    if (element) snapshot.set(entryKey, element);\n    else snapshot.delete(entryKey);\n    return () => { snapshot.delete(entryKey); };\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/case-31.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "computed-callable-through-two-aliases",
    code: 'import * as React from "react";\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const providers: Record<string, () => void> = {}; const providerKey = String(attributes?.id); const first = providers[providerKey]; const second = first; second();\n  const entryKey = "card";\n  \n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(entryKey, element);\n    else snapshot.delete(entryKey);\n    return () => { snapshot.delete(entryKey); };\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/case-32.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "computed-constructor-through-conditional-alias",
    code: 'import * as React from "react";\ninterface Props { constructors: Record<string, new () => object>; keyName: string; enabled: boolean; }\nexport const ConstructedEntry = ({ constructors, keyName, enabled }: Props) => {\n  const first = enabled ? constructors[keyName] : class {};\n  const second = first; new second();\n  const entries = React.useRef(new Map<string, HTMLLIElement>());\n  return <li ref={(element) => { const snapshot = entries.current; if (element) snapshot.set("card", element); else snapshot.delete("card"); return () => { snapshot.delete("card"); }; }} />;\n};',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/case-33.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "computed-data-only-ordinary-input",
    code: 'import * as React from "react";\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nconst labels: Record<string, string> = {}; const labelKey = "title" as string; const label = labels[labelKey]; void label;\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  \n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(entryKey, element);\n    else snapshot.delete(entryKey);\n    return () => { snapshot.delete(entryKey); };\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/case-34.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "computed-constructor-selector-alias",
    code: 'import * as React from "react";\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nconst propertyName = "constructor"; const provider = (() => {})[propertyName]; void provider;\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  \n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(entryKey, element);\n    else snapshot.delete(entryKey);\n    return () => { snapshot.delete(entryKey); };\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/case-35.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "ambient-ref-declaration",
    code: 'import * as React from "react";\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\ndeclare const phantom: unknown; void phantom;\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  \n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(entryKey, element);\n    else snapshot.delete(entryKey);\n    return () => { snapshot.delete(entryKey); };\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/case-36.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "erased-interface-value-reference",
    code: 'import * as React from "react";\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\ninterface provider {} const replace = () => { provider = {}; }; void replace;\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  \n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(entryKey, element);\n    else snapshot.delete(entryKey);\n    return () => { snapshot.delete(entryKey); };\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/case-37.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "readonly-named-react-import",
    code: 'import { useRef } from "react";\nexport const NamedEntries = () => {\n const entries = useRef(new Map<string, HTMLLIElement>());\n return <li ref={(element) => { const snapshot = entries.current; if(element) snapshot.set("card", element); else snapshot.delete("card"); return () => { snapshot.delete("card"); }; }} />;\n};',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/case-38.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "returned-delete-function-default-parameter",
    code: 'import * as React from "react";\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  \n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(entryKey, element);\n    else snapshot.delete(entryKey);\n    return (extra = onInspect?.(element)) => { snapshot.delete(entryKey); };\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/case-39.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "visible-nested-selected-key-getter",
    code: 'import * as React from "react";\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  let sequence = 0; const item = { entry: { get id() { sequence += 1; return String(sequence); } } };\n  React.useEffect(() => { entries.current.get(item.entry.id)?.focus(); }, [item.entry.id]);\n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(item.entry.id, element);\n    else snapshot.delete(item.entry.id);\n    return () => { snapshot.delete(item.entry.id); };\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/visible-nested-selected-key-getter.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "ordinary-nested-selected-key-data",
    code: 'import * as React from "react";\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const item = { entry: { id: "card" } };\n  React.useEffect(() => { entries.current.get(item.entry.id)?.focus(); }, [item.entry.id]);\n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(item.entry.id, element);\n    else snapshot.delete(item.entry.id);\n    return () => { snapshot.delete(item.entry.id); };\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/ordinary-nested-selected-key-data.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "nested-selected-key-getter-through-property-value-alias",
    code: 'import * as React from "react";\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  let sequence = 0; const entry = { get id() { sequence += 1; return String(sequence); } }; const item = { entry };\n  React.useEffect(() => { entries.current.get(item.entry.id)?.focus(); }, [item.entry.id]);\n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(item.entry.id, element);\n    else snapshot.delete(item.entry.id);\n    return () => { snapshot.delete(item.entry.id); };\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename:
        "src/callback-map-snapshot/nested-selected-key-getter-through-property-value-alias.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "nested-selected-key-member-alias-write",
    code: 'import * as React from "react";\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const item = { entry: { id: "card" } }; const alias = item.entry; const change = () => { alias.id = "other"; };\n  React.useEffect(() => { entries.current.get(item.entry.id)?.focus(); }, [item.entry.id]);\n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(item.entry.id, element);\n    else snapshot.delete(item.entry.id);\n    return () => { snapshot.delete(item.entry.id); };\n  }} onClick={change}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-snapshot/nested-selected-key-member-alias-write.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 1,
  },
];

describe("callback-local Map snapshot null detachment", () => {
  it.each(cases)("$name", ({ code, effectiveOptions, expected }) => {
    const result = runRule(noRefCallbackCleanupBeforeReact19, code, effectiveOptions);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
