import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RunRuleOptions, RunRuleResult } from "../../../test-utils/run-rule.js";
import { noSideEffectInStateUpdaterFunction } from "./no-side-effect-in-state-updater-function.js";

interface GuardedRecordCase {
  name: string;
  code: string;
  options: RunRuleOptions;
  expectedResult: RunRuleResult;
}

const cases: GuardedRecordCase[] = [
  {
    name: "two-site-correlated-fresh-or-borrowed",
    code: 'import { useState } from "react";\nexport const Inventory = ({ items, epoch, ready, onInspect }) => {\n  const [record, setRecord] = useState({ epoch: 0, entries: {} });\n  const apply = () => setRecord(prior => {\n      let copied = prior.epoch !== epoch;\n      let draft = copied ? {} : prior.entries;\n      for (const item of items) {\n        const entry = draft[item.id];\n        if (!entry) {\n          if (!copied) draft = { ...draft };\n          draft[item.id] = { caption: item.caption, expanded: false };\n          copied = true;\n        } else if (entry.caption !== item.caption) {\n          if (!copied) draft = { ...draft };\n          draft[item.id] = { ...entry, caption: item.caption, expanded: false };\n          copied = true;\n        }\n      }\n      return copied ? { epoch, entries: draft } : prior;\n  });\n  return <button onClick={apply}>{record.epoch}</button>;\n};\n',
    options: {
      filename: "synthetic-guarded-record.jsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "single-site-correlated-initializer",
    code: 'import { useState } from "react";\nexport const Inventory = ({ items, epoch, ready, onInspect }) => {\n  const [record, setRecord] = useState({ epoch: 0, entries: {} });\n  const apply = () => setRecord(prior => {\n      let copied = prior.epoch !== epoch;\n      let draft = copied ? {} : prior.entries;\n      for (const item of items) {\n        const entry = draft[item.id];\n        if (!entry) {\n          if (!copied) draft = { ...draft };\n          draft[item.id] = { caption: item.caption, expanded: false };\n          copied = true;\n        }\n      }\n      return copied ? { epoch, entries: draft } : prior;\n  });\n  return <button onClick={apply}>{record.epoch}</button>;\n};\n',
    options: {
      filename: "synthetic-guarded-record.jsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "two-sites-initial-false-alias",
    code: 'import { useState } from "react";\nexport const Inventory = ({ items, epoch, ready, onInspect }) => {\n  const [record, setRecord] = useState({ epoch: 0, entries: {} });\n  const apply = () => setRecord(prior => {\n      let copied = false;\n      let draft = prior.entries;\n      for (const item of items) {\n        const entry = draft[item.id];\n        if (!entry) {\n          if (!copied) draft = { ...draft };\n          draft[item.id] = { caption: item.caption, expanded: false };\n          copied = true;\n        } else if (entry.caption !== item.caption) {\n          if (!copied) draft = { ...draft };\n          draft[item.id] = { ...entry, caption: item.caption, expanded: false };\n          copied = true;\n        }\n      }\n      return copied ? { epoch, entries: draft } : prior;\n  });\n  return <button onClick={apply}>{record.epoch}</button>;\n};\n',
    options: {
      filename: "synthetic-guarded-record.jsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
        },
      },
    },
    expectedResult: {
      diagnostics: [
        {
          column: 10,
          line: 11,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
        {
          column: 10,
          line: 15,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "second-site-missing-copy",
    code: 'import { useState } from "react";\nexport const Inventory = ({ items, epoch, ready, onInspect }) => {\n  const [record, setRecord] = useState({ epoch: 0, entries: {} });\n  const apply = () => setRecord(prior => {\n      let copied = prior.epoch !== epoch;\n      let draft = copied ? {} : prior.entries;\n      for (const item of items) {\n        const entry = draft[item.id];\n        if (!entry) {\n          if (!copied) draft = { ...draft };\n          draft[item.id] = { caption: item.caption, expanded: false };\n          copied = true;\n        } else if (entry.caption !== item.caption) {\n          draft[item.id] = { ...entry, caption: item.caption, expanded: false };\n          copied = true;\n        }\n      }\n      return copied ? { epoch, entries: draft } : prior;\n  });\n  return <button onClick={apply}>{record.epoch}</button>;\n};\n',
    options: {
      filename: "synthetic-guarded-record.jsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
        },
      },
    },
    expectedResult: {
      diagnostics: [
        {
          column: 10,
          line: 11,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
        {
          column: 10,
          line: 14,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "true-flag-with-borrowed-container",
    code: 'import { useState } from "react";\nexport const Inventory = ({ items, epoch, ready, onInspect }) => {\n  const [record, setRecord] = useState({ epoch: 0, entries: {} });\n  const apply = () => setRecord(prior => {\n      let copied = true;\n      let draft = prior.entries;\n      for (const item of items) {\n        const entry = draft[item.id];\n        if (!entry) {\n          if (!copied) draft = { ...draft };\n          draft[item.id] = { caption: item.caption, expanded: false };\n          copied = true;\n        } else if (entry.caption !== item.caption) {\n          if (!copied) draft = { ...draft };\n          draft[item.id] = { ...entry, caption: item.caption, expanded: false };\n          copied = true;\n        }\n      }\n      return copied ? { epoch, entries: draft } : prior;\n  });\n  return <button onClick={apply}>{record.epoch}</button>;\n};\n',
    options: {
      filename: "synthetic-guarded-record.jsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
        },
      },
    },
    expectedResult: {
      diagnostics: [
        {
          column: 10,
          line: 11,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
        {
          column: 10,
          line: 15,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "flag-premature-true",
    code: 'import { useState } from "react";\nexport const Inventory = ({ items, epoch, ready, onInspect }) => {\n  const [record, setRecord] = useState({ epoch: 0, entries: {} });\n  const apply = () => setRecord(prior => {\n      let copied = prior.epoch !== epoch;\n      let draft = copied ? {} : prior.entries;\n      for (const item of items) {\n        const entry = draft[item.id];\n        if (!entry) {\n          copied = true;\n          if (!copied) draft = { ...draft };\n          draft[item.id] = { caption: item.caption, expanded: false };\n          copied = true;\n        } else if (entry.caption !== item.caption) {\n          if (!copied) draft = { ...draft };\n          draft[item.id] = { ...entry, caption: item.caption, expanded: false };\n          copied = true;\n        }\n      }\n      return copied ? { epoch, entries: draft } : prior;\n  });\n  return <button onClick={apply}>{record.epoch}</button>;\n};\n',
    options: {
      filename: "synthetic-guarded-record.jsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
        },
      },
    },
    expectedResult: {
      diagnostics: [
        {
          column: 10,
          line: 12,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
        {
          column: 10,
          line: 16,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "reassign-borrowed-after-copy",
    code: 'import { useState } from "react";\nexport const Inventory = ({ items, epoch, ready, onInspect }) => {\n  const [record, setRecord] = useState({ epoch: 0, entries: {} });\n  const apply = () => setRecord(prior => {\n      let copied = prior.epoch !== epoch;\n      let draft = copied ? {} : prior.entries;\n      for (const item of items) {\n        const entry = draft[item.id];\n        if (!entry) {\n          if (!copied) draft = { ...draft };\n          draft = prior.entries;\n          draft[item.id] = { caption: item.caption, expanded: false };\n          copied = true;\n        } else if (entry.caption !== item.caption) {\n          if (!copied) draft = { ...draft };\n          draft[item.id] = { ...entry, caption: item.caption, expanded: false };\n          copied = true;\n        }\n      }\n      return copied ? { epoch, entries: draft } : prior;\n  });\n  return <button onClick={apply}>{record.epoch}</button>;\n};\n',
    options: {
      filename: "synthetic-guarded-record.jsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
        },
      },
    },
    expectedResult: {
      diagnostics: [
        {
          column: 10,
          line: 12,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
        {
          column: 10,
          line: 16,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "wrong-guard-symbol",
    code: 'import { useState } from "react";\nexport const Inventory = ({ items, epoch, ready, onInspect }) => {\n  const [record, setRecord] = useState({ epoch: 0, entries: {} });\n  const apply = () => setRecord(prior => {\n      let copied = prior.epoch !== epoch;\n      let draft = copied ? {} : prior.entries;\n      for (const item of items) {\n        const entry = draft[item.id];\n        if (!entry) {\n          if (!ready) draft = { ...draft };\n          draft[item.id] = { caption: item.caption, expanded: false };\n          copied = true;\n        } else if (entry.caption !== item.caption) {\n          if (!ready) draft = { ...draft };\n          draft[item.id] = { ...entry, caption: item.caption, expanded: false };\n          copied = true;\n        }\n      }\n      return copied ? { epoch, entries: draft } : prior;\n  });\n  return <button onClick={apply}>{record.epoch}</button>;\n};\n',
    options: {
      filename: "synthetic-guarded-record.jsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
        },
      },
    },
    expectedResult: {
      diagnostics: [
        {
          column: 10,
          line: 11,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
        {
          column: 10,
          line: 15,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "shadowed-flag-binding",
    code: 'import { useState } from "react";\nexport const Inventory = ({ items, epoch, ready, onInspect }) => {\n  const [record, setRecord] = useState({ epoch: 0, entries: {} });\n  const apply = () => setRecord(prior => {\n      let copied = prior.epoch !== epoch;\n      let draft = copied ? {} : prior.entries;\n      for (const item of items) {\n        const entry = draft[item.id];\n        if (!entry) {\n          let copied = true;\n          if (!copied) draft = { ...draft };\n          draft[item.id] = { caption: item.caption, expanded: false };\n          copied = true;\n        } else if (entry.caption !== item.caption) {\n          if (!copied) draft = { ...draft };\n          draft[item.id] = { ...entry, caption: item.caption, expanded: false };\n          copied = true;\n        }\n      }\n      return copied ? { epoch, entries: draft } : prior;\n  });\n  return <button onClick={apply}>{record.epoch}</button>;\n};\n',
    options: {
      filename: "synthetic-guarded-record.jsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
        },
      },
    },
    expectedResult: {
      diagnostics: [
        {
          column: 10,
          line: 12,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
        {
          column: 10,
          line: 16,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "shallow-copy-child-mutation",
    code: 'import { useState } from "react";\nexport const Inventory = ({ items, epoch, ready, onInspect }) => {\n  const [record, setRecord] = useState({ epoch: 0, entries: {} });\n  const apply = () => setRecord(prior => {\n      let copied = prior.epoch !== epoch;\n      let draft = copied ? {} : prior.entries;\n      for (const item of items) {\n        const entry = draft[item.id];\n        if (!entry) {\n          if (!copied) draft = { ...draft };\n          draft[item.id] = { caption: item.caption, expanded: false };\n          copied = true;\n        } else if (entry.caption !== item.caption) {\n          if (!copied) draft = { ...draft };\n          entry.caption = item.caption;\n          copied = true;\n        }\n      }\n      return copied ? { epoch, entries: draft } : prior;\n  });\n  return <button onClick={apply}>{record.epoch}</button>;\n};\n',
    options: {
      filename: "synthetic-guarded-record.jsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
        },
      },
    },
    expectedResult: {
      diagnostics: [
        {
          column: 10,
          line: 11,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
        {
          column: 10,
          line: 15,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "container-escape",
    code: 'import { useState } from "react";\nexport const Inventory = ({ items, epoch, ready, onInspect }) => {\n  const [record, setRecord] = useState({ epoch: 0, entries: {} });\n  const apply = () => setRecord(prior => {\n      let copied = prior.epoch !== epoch;\n      let draft = copied ? {} : prior.entries;\n      onInspect(draft);\n      for (const item of items) {\n        const entry = draft[item.id];\n        if (!entry) {\n          if (!copied) draft = { ...draft };\n          draft[item.id] = { caption: item.caption, expanded: false };\n          copied = true;\n        } else if (entry.caption !== item.caption) {\n          if (!copied) draft = { ...draft };\n          draft[item.id] = { ...entry, caption: item.caption, expanded: false };\n          copied = true;\n        }\n      }\n      return copied ? { epoch, entries: draft } : prior;\n  });\n  return <button onClick={apply}>{record.epoch}</button>;\n};\n',
    options: {
      filename: "synthetic-guarded-record.jsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
        },
      },
    },
    expectedResult: {
      diagnostics: [
        {
          column: 6,
          line: 7,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "CallExpression",
        },
        {
          column: 10,
          line: 12,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
        {
          column: 10,
          line: 16,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "captured-container",
    code: 'import { useState } from "react";\nexport const Inventory = ({ items, epoch, ready, onInspect }) => {\n  const [record, setRecord] = useState({ epoch: 0, entries: {} });\n  const apply = () => setRecord(prior => {\n      let copied = prior.epoch !== epoch;\n      let draft = copied ? {} : prior.entries;\n      const expose = () => draft;\n      onInspect(expose);\n      for (const item of items) {\n        const entry = draft[item.id];\n        if (!entry) {\n          if (!copied) draft = { ...draft };\n          draft[item.id] = { caption: item.caption, expanded: false };\n          copied = true;\n        } else if (entry.caption !== item.caption) {\n          if (!copied) draft = { ...draft };\n          draft[item.id] = { ...entry, caption: item.caption, expanded: false };\n          copied = true;\n        }\n      }\n      return copied ? { epoch, entries: draft } : prior;\n  });\n  return <button onClick={apply}>{record.epoch}</button>;\n};\n',
    options: {
      filename: "synthetic-guarded-record.jsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
        },
      },
    },
    expectedResult: {
      diagnostics: [
        {
          column: 6,
          line: 8,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "CallExpression",
        },
        {
          column: 10,
          line: 13,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
        {
          column: 10,
          line: 17,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "conditional-copy-guard",
    code: 'import { useState } from "react";\nexport const Inventory = ({ items, epoch, ready, onInspect }) => {\n  const [record, setRecord] = useState({ epoch: 0, entries: {} });\n  const apply = () => setRecord(prior => {\n      let copied = prior.epoch !== epoch;\n      let draft = copied ? {} : prior.entries;\n      for (const item of items) {\n        const entry = draft[item.id];\n        if (!entry) {\n          if (!copied && ready) draft = { ...draft };\n          draft[item.id] = { caption: item.caption, expanded: false };\n          copied = true;\n        } else if (entry.caption !== item.caption) {\n          if (!copied && ready) draft = { ...draft };\n          draft[item.id] = { ...entry, caption: item.caption, expanded: false };\n          copied = true;\n        }\n      }\n      return copied ? { epoch, entries: draft } : prior;\n  });\n  return <button onClick={apply}>{record.epoch}</button>;\n};\n',
    options: {
      filename: "synthetic-guarded-record.jsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
        },
      },
    },
    expectedResult: {
      diagnostics: [
        {
          column: 10,
          line: 11,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
        {
          column: 10,
          line: 15,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "after-write-copy",
    code: 'import { useState } from "react";\nexport const Inventory = ({ items, epoch, ready, onInspect }) => {\n  const [record, setRecord] = useState({ epoch: 0, entries: {} });\n  const apply = () => setRecord(prior => {\n      let copied = prior.epoch !== epoch;\n      let draft = copied ? {} : prior.entries;\n      for (const item of items) {\n        const entry = draft[item.id];\n        if (!entry) {\n          draft[item.id] = { caption: item.caption, expanded: false };\n          if (!copied) draft = { ...draft };\n          copied = true;\n        } else if (entry.caption !== item.caption) {\n          if (!copied) draft = { ...draft };\n          draft[item.id] = { ...entry, caption: item.caption, expanded: false };\n          copied = true;\n        }\n      }\n      return copied ? { epoch, entries: draft } : prior;\n  });\n  return <button onClick={apply}>{record.epoch}</button>;\n};\n',
    options: {
      filename: "synthetic-guarded-record.jsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
        },
      },
    },
    expectedResult: {
      diagnostics: [
        {
          column: 10,
          line: 10,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
        {
          column: 10,
          line: 15,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "literal-false-reset-after-commit",
    code: 'import { useState } from "react";\nexport const Inventory = ({ items, epoch, ready, onInspect }) => {\n  const [record, setRecord] = useState({ epoch: 0, entries: {} });\n  const apply = () => setRecord(prior => {\n      let copied = prior.epoch !== epoch;\n      let draft = copied ? {} : prior.entries;\n      for (const item of items) {\n        const entry = draft[item.id];\n        if (!entry) {\n          if (!copied) draft = { ...draft };\n          draft[item.id] = { caption: item.caption, expanded: false };\n          copied = true;\n          if (ready) copied = false;\n        } else if (entry.caption !== item.caption) {\n          if (!copied) draft = { ...draft };\n          draft[item.id] = { ...entry, caption: item.caption, expanded: false };\n          copied = true;\n          if (ready) copied = false;\n        }\n      }\n      return copied ? { epoch, entries: draft } : prior;\n  });\n  return <button onClick={apply}>{record.epoch}</button>;\n};\n',
    options: {
      filename: "synthetic-guarded-record.jsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
        },
      },
    },
    expectedResult: {
      diagnostics: [
        {
          column: 10,
          line: 11,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
        {
          column: 10,
          line: 16,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "independent-side-effect",
    code: 'import { useState } from "react";\nexport const Inventory = ({ items, epoch, ready, onInspect }) => {\n  const [record, setRecord] = useState({ epoch: 0, entries: {} });\n  const apply = () => setRecord(prior => {\n      let copied = prior.epoch !== epoch;\n      let draft = copied ? {} : prior.entries;\n      trackEvent("refresh");\n      for (const item of items) {\n        const entry = draft[item.id];\n        if (!entry) {\n          if (!copied) draft = { ...draft };\n          draft[item.id] = { caption: item.caption, expanded: false };\n          copied = true;\n        } else if (entry.caption !== item.caption) {\n          if (!copied) draft = { ...draft };\n          draft[item.id] = { ...entry, caption: item.caption, expanded: false };\n          copied = true;\n        }\n      }\n      return copied ? { epoch, entries: draft } : prior;\n  });\n  return <button onClick={apply}>{record.epoch}</button>;\n};\n',
    options: {
      filename: "synthetic-guarded-record.jsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
        },
      },
    },
    expectedResult: {
      diagnostics: [
        {
          column: 6,
          line: 7,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "CallExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "direct-eval-invalidates-flag",
    code: 'import { useState } from "react";\nexport const Inventory = ({ items, epoch, ready, onInspect }) => {\n  const [record, setRecord] = useState({ epoch: 0, entries: {} });\n  const apply = () => setRecord(prior => {\n      let copied = prior.epoch !== epoch;\n      let draft = copied ? {} : prior.entries;\n      eval("copied = true");\n      for (const item of items) {\n        const entry = draft[item.id];\n        if (!entry) {\n          if (!copied) draft = { ...draft };\n          draft[item.id] = { caption: item.caption, expanded: false };\n          copied = true;\n        } else if (entry.caption !== item.caption) {\n          if (!copied) draft = { ...draft };\n          draft[item.id] = { ...entry, caption: item.caption, expanded: false };\n          copied = true;\n        }\n      }\n      return copied ? { epoch, entries: draft } : prior;\n  });\n  return <button onClick={apply}>{record.epoch}</button>;\n};\n',
    options: {
      filename: "synthetic-guarded-record.jsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
        },
      },
    },
    expectedResult: {
      diagnostics: [
        {
          column: 10,
          line: 12,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
        {
          column: 10,
          line: 16,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "both-branches-fresh-existing1902",
    code: 'import { useState } from "react";\nexport const Inventory = ({ items, epoch, ready, onInspect }) => {\n  const [record, setRecord] = useState({ epoch: 0, entries: {} });\n  const apply = () => setRecord(prior => {\n      const draft = ready ? {} : { ...prior.entries };\n      draft.item = { caption: "safe" };\n      return { epoch, entries: draft };\n  });\n  return <button onClick={apply}>{record.epoch}</button>;\n};\n',
    options: {
      filename: "synthetic-guarded-record.jsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "whole-record-alias-before-valid-triplets",
    code: 'import { useState } from "react";\nexport const Inventory = ({ items, epoch, ready, onInspect }) => {\n  const [record, setRecord] = useState({ epoch: 0, entries: {} });\n  const apply = () => setRecord(prior => {\n      let copied = prior.epoch !== epoch;\n      let draft = copied ? {} : prior.entries;\n      const borrowed = draft;\n      borrowed.untracked = { caption: "changed" };\n      for (const item of items) {\n        const entry = draft[item.id];\n        if (!entry) {\n          if (!copied) draft = { ...draft };\n          draft[item.id] = { caption: item.caption, expanded: false };\n          copied = true;\n        } else if (entry.caption !== item.caption) {\n          if (!copied) draft = { ...draft };\n          draft[item.id] = { ...entry, caption: item.caption, expanded: false };\n          copied = true;\n        }\n      }\n      return copied ? { epoch, entries: draft } : prior;\n  });\n  return <button onClick={apply}>{record.epoch}</button>;\n};\n',
    options: {
      filename: "synthetic-guarded-record.jsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
        },
      },
    },
    expectedResult: {
      diagnostics: [
        {
          column: 6,
          line: 8,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
        {
          column: 10,
          line: 13,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
        {
          column: 10,
          line: 17,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "prior-entry-child-write-after-valid-root-replacement",
    code: 'import { useState } from "react";\nexport const Inventory = ({ items, epoch, ready, onInspect }) => {\n  const [record, setRecord] = useState({ epoch: 0, entries: {} });\n  const apply = () => setRecord(prior => {\n      let copied = prior.epoch !== epoch;\n      let draft = copied ? {} : prior.entries;\n      for (const item of items) {\n        const entry = draft[item.id];\n        if (!entry) {\n          if (!copied) draft = { ...draft };\n          draft[item.id] = { caption: item.caption, expanded: false };\n          copied = true;\n        } else if (entry.caption !== item.caption) {\n          if (!copied) draft = { ...draft };\n          draft[item.id] = { ...entry, caption: item.caption, expanded: false };\n          copied = true;\n          entry.caption = item.caption;\n        }\n      }\n      return copied ? { epoch, entries: draft } : prior;\n  });\n  return <button onClick={apply}>{record.epoch}</button>;\n};\n',
    options: {
      filename: "synthetic-guarded-record.jsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
        },
      },
    },
    expectedResult: {
      diagnostics: [
        {
          column: 10,
          line: 11,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
        {
          column: 10,
          line: 15,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
        {
          column: 10,
          line: 17,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "captured-unpaired-flag-commit",
    code: 'import { useState } from "react";\nexport const Inventory = ({ items, epoch, ready, onInspect }) => {\n  const [record, setRecord] = useState({ epoch: 0, entries: {} });\n  const apply = () => setRecord(prior => {\n      let copied = prior.epoch !== epoch;\n      let draft = copied ? {} : prior.entries;\n      const markCopied = () => { copied = true; };\n      markCopied();\n      for (const item of items) {\n        const entry = draft[item.id];\n        if (!entry) {\n          if (!copied) draft = { ...draft };\n          draft[item.id] = { caption: item.caption, expanded: false };\n          copied = true;\n        } else if (entry.caption !== item.caption) {\n          if (!copied) draft = { ...draft };\n          draft[item.id] = { ...entry, caption: item.caption, expanded: false };\n          copied = true;\n        }\n      }\n      return copied ? { epoch, entries: draft } : prior;\n  });\n  return <button onClick={apply}>{record.epoch}</button>;\n};\n',
    options: {
      filename: "synthetic-guarded-record.jsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
        },
      },
    },
    expectedResult: {
      diagnostics: [
        {
          column: 10,
          line: 13,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
        {
          column: 10,
          line: 17,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "borrowed-source-owner-alias-write",
    code: 'import { useState } from "react";\nexport const Inventory = ({ items, epoch, ready, onInspect }) => {\n  const [record, setRecord] = useState({ epoch: 0, entries: {} });\n  const apply = () => setRecord(prior => {\n      let copied = prior.epoch !== epoch;\n      let draft = copied ? {} : prior.entries;\n      const owner = prior;\n      owner.entries = {};\n      for (const item of items) {\n        const entry = draft[item.id];\n        if (!entry) {\n          if (!copied) draft = { ...draft };\n          draft[item.id] = { caption: item.caption, expanded: false };\n          copied = true;\n        } else if (entry.caption !== item.caption) {\n          if (!copied) draft = { ...draft };\n          draft[item.id] = { ...entry, caption: item.caption, expanded: false };\n          copied = true;\n        }\n      }\n      return copied ? { epoch, entries: draft } : prior;\n  });\n  return <button onClick={apply}>{record.epoch}</button>;\n};\n',
    options: {
      filename: "synthetic-guarded-record.jsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
        },
      },
    },
    expectedResult: {
      diagnostics: [
        {
          column: 10,
          line: 13,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
        {
          column: 10,
          line: 17,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "extra-unguarded-root-write-before-valid-triplets",
    code: 'import { useState } from "react";\nexport const Inventory = ({ items, epoch, ready, onInspect }) => {\n  const [record, setRecord] = useState({ epoch: 0, entries: {} });\n  const apply = () => setRecord(prior => {\n      let copied = prior.epoch !== epoch;\n      let draft = copied ? {} : prior.entries;\n      draft.early = { caption: "unguarded" };\n      for (const item of items) {\n        const entry = draft[item.id];\n        if (!entry) {\n          if (!copied) draft = { ...draft };\n          draft[item.id] = { caption: item.caption, expanded: false };\n          copied = true;\n        } else if (entry.caption !== item.caption) {\n          if (!copied) draft = { ...draft };\n          draft[item.id] = { ...entry, caption: item.caption, expanded: false };\n          copied = true;\n        }\n      }\n      return copied ? { epoch, entries: draft } : prior;\n  });\n  return <button onClick={apply}>{record.epoch}</button>;\n};\n',
    options: {
      filename: "synthetic-guarded-record.jsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
        },
      },
    },
    expectedResult: {
      diagnostics: [
        {
          column: 6,
          line: 7,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
        {
          column: 10,
          line: 12,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
        {
          column: 10,
          line: 16,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "invoked-nested-direct-eval-without-explicit-flag-reference",
    code: 'import { useState } from "react";\nexport const Inventory = ({ items, epoch, ready, onInspect }) => {\n  const [record, setRecord] = useState({ epoch: 0, entries: {} });\n  const apply = () => setRecord(prior => {\n      let copied = prior.epoch !== epoch;\n      let draft = copied ? {} : prior.entries;\n      const rewrite = () => eval("copied = true");\n      rewrite();\n      for (const item of items) {\n        const entry = draft[item.id];\n        if (!entry) {\n          if (!copied) draft = { ...draft };\n          draft[item.id] = { caption: item.caption, expanded: false };\n          copied = true;\n        } else if (entry.caption !== item.caption) {\n          if (!copied) draft = { ...draft };\n          draft[item.id] = { ...entry, caption: item.caption, expanded: false };\n          copied = true;\n        }\n      }\n      return copied ? { epoch, entries: draft } : prior;\n  });\n  return <button onClick={apply}>{record.epoch}</button>;\n};\n',
    options: {
      filename: "synthetic-guarded-record.jsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
        },
      },
    },
    expectedResult: {
      diagnostics: [
        {
          column: 10,
          line: 13,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
        {
          column: 10,
          line: 17,
          message:
            "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
          nodeType: "AssignmentExpression",
        },
      ],
      parseErrors: [],
    },
  },
];

describe("mixed-initializer guarded record copies", () => {
  it.each(cases)("$name", (testCase) => {
    const result = runRule(noSideEffectInStateUpdaterFunction, testCase.code, testCase.options);
    expect(result).toEqual(testCase.expectedResult);
  });
});
