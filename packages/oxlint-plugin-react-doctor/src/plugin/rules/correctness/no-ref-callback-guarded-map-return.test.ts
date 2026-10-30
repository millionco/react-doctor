import { describe, expect, it } from "vite-plus/test";
import type { RunRuleOptions } from "../../../test-utils/run-rule.js";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRefCallbackCleanupBeforeReact19 } from "./no-ref-callback-cleanup-before-react-19.js";

interface GuardedReturnCase {
  name: string;
  code: string;
  effectiveOptions: RunRuleOptions;
  expected: number;
}

const cases: readonly GuardedReturnCase[] = [
  {
    name: "direct-guarded-return-null-delete",
    code: 'import * as React from "react";\n\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  \n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-guarded-return/case-00.tsx",
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
    name: "stable-external-property-key",
    code: 'import * as React from "react";\n\nexport const EntryPanel = ({ record }: { record: { id: string } }) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  \n  \n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(record.id, element);\n      return () => {\n        if (entries.current.get(record.id) === element) entries.current.delete(record.id);\n      };\n    } else {\n      entries.current.delete(record.id);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-guarded-return/case-01.tsx",
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
    name: "discarded-focus-observer",
    code: 'import * as React from "react";\n\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  React.useEffect(() => { entries.current.get(entryKey)?.focus(); }, [entryKey]);\n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-guarded-return/case-02.tsx",
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
    name: "exact-readonly-native-effect-selector",
    code: 'import * as React from "react";\nconst useBrowserEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  useBrowserEffect(() => { entries.current.get(entryKey)?.focus(); }, [entryKey]);\n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-guarded-return/case-03.tsx",
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
    name: "missing-null-delete",
    code: 'import * as React from "react";\n\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  \n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      void element;\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-guarded-return/case-04.tsx",
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
    name: "wrong-null-key",
    code: 'import * as React from "react";\n\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  \n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete("other");\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-guarded-return/case-05.tsx",
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
    name: "wrong-guard-key",
    code: 'import * as React from "react";\n\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  \n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get("other") === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-guarded-return/case-06.tsx",
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
    name: "wrong-return-delete-key",
    code: 'import * as React from "react";\n\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  \n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete("other");\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-guarded-return/case-07.tsx",
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
    name: "different-attached-value",
    code: 'import * as React from "react";\n\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  \n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, document.createElement("li"));\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-guarded-return/case-08.tsx",
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
    name: "loose-equality-guard",
    code: 'import * as React from "react";\n\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  \n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) == element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-guarded-return/case-09.tsx",
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
    name: "extra-guard-conjunct",
    code: 'import * as React from "react";\n\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  \n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element && entryKey.length) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-guarded-return/case-10.tsx",
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
    name: "unrelated-truthy-return-guard",
    code: 'import * as React from "react";\n\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  \n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-guarded-return/case-11.tsx",
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
    name: "extra-returned-effect",
    code: 'import * as React from "react";\n\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  \n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => { console.log(element);\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-guarded-return/case-12.tsx",
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
    name: "cleanup-default-parameter",
    code: 'import * as React from "react";\n\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  \n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return (extra = console.log(element)) => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-guarded-return/case-13.tsx",
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
    name: "callback-extra-default-parameter",
    code: 'import * as React from "react";\n\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  \n  return <li ref={(element, extra = console.log("extra")) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-guarded-return/case-14.tsx",
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
    name: "ref-current-replaced",
    code: 'import * as React from "react";\n\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  entries.current = new Map();\n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-guarded-return/case-15.tsx",
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
    name: "selected-map-escaped",
    code: 'import * as React from "react";\n\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  console.log(entries.current);\n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-guarded-return/case-16.tsx",
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
    name: "selected-method-overridden",
    code: 'import * as React from "react";\n\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  entries.current.delete = () => false;\n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-guarded-return/case-17.tsx",
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
    name: "nested-key-getter",
    code: 'import * as React from "react";\n\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const record = { entry: { get id() { return String(Math.random()); } } };\n  \n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(record.entry.id, element);\n      return () => {\n        if (entries.current.get(record.entry.id) === element) entries.current.delete(record.entry.id);\n      };\n    } else {\n      entries.current.delete(record.entry.id);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-guarded-return/case-18.tsx",
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
    name: "subobject-key-alias-write",
    code: 'import * as React from "react";\n\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const record = { entry: { id: "first" } }; const alias = record.entry; alias.id = "next";\n  \n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(record.entry.id, element);\n      return () => {\n        if (entries.current.get(record.entry.id) === element) entries.current.delete(record.entry.id);\n      };\n    } else {\n      entries.current.delete(record.entry.id);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-guarded-return/case-19.tsx",
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
    name: "ordinary-nested-key-data",
    code: 'import * as React from "react";\n\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const record = { entry: { id: "entry" } };\n  \n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(record.entry.id, element);\n      return () => {\n        if (entries.current.get(record.entry.id) === element) entries.current.delete(record.entry.id);\n      };\n    } else {\n      entries.current.delete(record.entry.id);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-guarded-return/case-20.tsx",
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
    name: "custom-host-component",
    code: 'import * as React from "react";\nconst Entry = (props: React.HTMLAttributes<HTMLLIElement>) => <li {...props} />;\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  \n  return <Entry ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</Entry>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-guarded-return/case-21.tsx",
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
    name: "later-ref-spread",
    code: 'import * as React from "react";\n\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  \n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }} {...{ ref: () => undefined }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-guarded-return/case-22.tsx",
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
    name: "shadowed-native-map",
    code: 'import * as React from "react";\nconst Map = class { set() { return this; } get() { return null; } delete() { return true; } };\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  \n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-guarded-return/case-23.tsx",
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
    name: "computed-constructor-provider",
    code: 'import * as React from "react";\n\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  const selector = "constructor"; const invoke = (() => undefined)[selector]; void invoke;\n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-guarded-return/case-24.tsx",
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
    name: "ambient-key-value",
    code: 'import * as React from "react";\ndeclare const entryKey: string;\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  \n  \n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-guarded-return/case-25.tsx",
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
    name: "shadowed-selector-window",
    code: 'import * as React from "react";\nconst window = {};\nconst useBrowserEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  useBrowserEffect(() => { entries.current.get(entryKey)?.focus(); }, [entryKey]);\n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-guarded-return/case-26.tsx",
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
    name: "selector-function-escaped",
    code: 'import * as React from "react";\nconst useBrowserEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;\nconsole.log(useBrowserEffect);\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  useBrowserEffect(() => { entries.current.get(entryKey)?.focus(); }, [entryKey]);\n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-guarded-return/case-27.tsx",
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
    name: "react-selector-member-written",
    code: 'import * as React from "react";\nconst useBrowserEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;\nReact.useLayoutEffect = React.useEffect;\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  useBrowserEffect(() => { entries.current.get(entryKey)?.focus(); }, [entryKey]);\n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-guarded-return/case-28.tsx",
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
    name: "callback-local-snapshot-is-separate-A",
    code: 'import * as React from "react";\n\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  \n  return <li ref={(element) => {\n    const snapshot = entries.current; if (element) snapshot.set(entryKey, element); else snapshot.delete(entryKey); return () => { snapshot.delete(entryKey); };\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-guarded-return/case-29.tsx",
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
    name: "guarded-null-delete",
    code: 'import * as React from "react";\n\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  \n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      if (entries.current.get(entryKey)) entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-guarded-return/case-30.tsx",
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
    name: "readonly-ref-owned-outside-component",
    code: 'import * as React from "react";\nconst sharedEntries = React.useRef<Map<string, HTMLLIElement>>(new Map());\nexport const EntryPanel = () => {\n  const entries = sharedEntries;\n  const entryKey = "entry";\n  \n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-guarded-return/case-31.tsx",
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
    name: "key-shadowed-in-cleanup",
    code: 'import * as React from "react";\n\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  \n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => { const entryKey = "other";\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-guarded-return/case-32.tsx",
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
    name: "conditional-selector-wrong-provider",
    code: 'import * as React from "react";\nconst useForeignEffect = (_callback: () => void, _dependencies: unknown[]) => undefined;\nconst useBrowserEffect = typeof window === "undefined" ? React.useEffect : useForeignEffect;\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  useBrowserEffect(() => { entries.current.get(entryKey)?.focus(); }, [entryKey]);\n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-guarded-return/case-33.tsx",
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
    name: "exported-hook-selector",
    code: 'import * as React from "react";\nexport const useBrowserEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  useBrowserEffect(() => { entries.current.get(entryKey)?.focus(); }, [entryKey]);\n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-guarded-return/case-34.tsx",
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
    name: "reassigned-hook-selector",
    code: 'import * as React from "react";\nlet useBrowserEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;\nuseBrowserEffect = React.useEffect;\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  useBrowserEffect(() => { entries.current.get(entryKey)?.focus(); }, [entryKey]);\n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-guarded-return/case-35.tsx",
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
    name: "selector-constructor-use",
    code: 'import * as React from "react";\nconst useBrowserEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  new useBrowserEffect(() => { entries.current.get(entryKey)?.focus(); }, [entryKey]);\n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-guarded-return/case-36.tsx",
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
    name: "selector-optional-call",
    code: 'import * as React from "react";\nconst useBrowserEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  useBrowserEffect?.(() => { entries.current.get(entryKey)?.focus(); }, [entryKey]);\n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-guarded-return/case-37.tsx",
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
    name: "selector-readonly-alias-chain",
    code: 'import * as React from "react";\nconst useBrowserEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;\nconst useOtherEffect = useBrowserEffect;\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  useOtherEffect(() => { entries.current.get(entryKey)?.focus(); }, [entryKey]);\n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-guarded-return/case-38.tsx",
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
    name: "unrelated-react-member-value-escape",
    code: 'import * as React from "react";\nconst useBrowserEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;\nconst unrelatedHook = React.useRef;\nconsole.log(unrelatedHook);\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  useBrowserEffect(() => { entries.current.get(entryKey)?.focus(); }, [entryKey]);\n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-guarded-return/case-39.tsx",
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
    name: "second-react-provider-write",
    code: 'import * as React from "react";\nimport * as OtherReact from "react";\nOtherReact.useRef = replacement;\nconst useBrowserEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  useBrowserEffect(() => { entries.current.get(entryKey)?.focus(); }, [entryKey]);\n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-guarded-return/case-40.tsx",
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
    name: "different-selector-window-use",
    code: 'import * as React from "react";\nconst useBrowserEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;\nconsole.log(window);\nexport const EntryPanel = () => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "entry";\n  useBrowserEffect(() => { entries.current.get(entryKey)?.focus(); }, [entryKey]);\n  return <li ref={(element) => {\n    if (element) {\n      entries.current.set(entryKey, element);\n      return () => {\n        if (entries.current.get(entryKey) === element) entries.current.delete(entryKey);\n      };\n    } else {\n      entries.current.delete(entryKey);\n    }\n  }}>Entry</li>;\n};\n',
    effectiveOptions: {
      filename: "src/callback-map-guarded-return/case-41.tsx",
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

describe("owned guarded callback Map return", () => {
  it.each(cases)("$name", ({ code, effectiveOptions, expected }) => {
    const result = runRule(noRefCallbackCleanupBeforeReact19, code, effectiveOptions);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
