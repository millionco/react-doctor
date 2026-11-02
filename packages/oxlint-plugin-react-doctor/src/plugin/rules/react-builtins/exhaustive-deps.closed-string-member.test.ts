import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { exhaustiveDeps } from "./exhaustive-deps.js";

const closedStringMemberCases = [
  {
    name: "closed-three-literal-fields",
    code: 'import { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { ADD: "add", REMOVE: "remove", NONE: "none" };\n  const callback = useCallback(() => actions.ADD, []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/closed-three-literal-fields.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "quiet",
  },
  {
    name: "explicit-selected-member-dependency",
    code: 'import { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { ADD: "add", REMOVE: "remove", NONE: "none" };\n  const callback = useCallback(() => actions.ADD, [actions.ADD]);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/explicit-selected-member-dependency.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "quiet",
  },
  {
    name: "other-reactive-capture-missing",
    code: 'import { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { ADD: "add", REMOVE: "remove", NONE: "none" };\n  const callback = useCallback(() => actions.ADD + value, []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/other-reactive-capture-missing.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "other-reactive",
  },
  {
    name: "other-reactive-capture-declared",
    code: 'import { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { ADD: "add", REMOVE: "remove", NONE: "none" };\n  const callback = useCallback(() => actions.ADD + value, [value]);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/other-reactive-capture-declared.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "quiet",
  },
  {
    name: "literal-primitive-kinds",
    code: 'import { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { TEXT: "add", NUMBER: 1, FLAG: true, EMPTY: null };\n  const callback = useCallback(() => [actions.TEXT, actions.NUMBER, actions.FLAG, actions.EMPTY], []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/literal-primitive-kinds.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "warning",
  },
  {
    name: "prop-derived-selected-field",
    code: 'import { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { ADD: value };\n  const callback = useCallback(() => actions.ADD, []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/prop-derived-selected-field.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "warning",
  },
  {
    name: "unknown-sibling-value",
    code: 'import { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { ADD: "add", OTHER: value };\n  const callback = useCallback(() => actions.ADD, []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/unknown-sibling-value.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "warning",
  },
  {
    name: "getter-selected-field",
    code: 'import { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { get ADD() { return value; } };\n  const callback = useCallback(() => actions.ADD, []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/getter-selected-field.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "warning",
  },
  {
    name: "duplicate-selected-field",
    code: 'import { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { ADD: "add", ADD: value };\n  const callback = useCallback(() => actions.ADD, []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/duplicate-selected-field.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "warning",
  },
  {
    name: "computed-static-field",
    code: 'import { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { ["ADD"]: "add" };\n  const callback = useCallback(() => actions.ADD, []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/computed-static-field.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "warning",
  },
  {
    name: "computed-unknown-sibling",
    code: 'import { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { ADD: "add", [other]: value };\n  const callback = useCallback(() => actions.ADD, []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/computed-unknown-sibling.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "warning",
  },
  {
    name: "spread-before-literal",
    code: 'import { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { ...other, ADD: "add" };\n  const callback = useCallback(() => actions.ADD, []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/spread-before-literal.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "warning",
  },
  {
    name: "spread-after-literal",
    code: 'import { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { ADD: "add", ...other };\n  const callback = useCallback(() => actions.ADD, []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/spread-after-literal.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "warning",
  },
  {
    name: "nested-object-selected",
    code: 'import { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { ADD: { value: "add" } };\n  const callback = useCallback(() => actions.ADD, []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/nested-object-selected.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "warning",
  },
  {
    name: "method-selected",
    code: 'import { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { ADD() { return "add"; } };\n  const callback = useCallback(() => actions.ADD, []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/method-selected.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "warning",
  },
  {
    name: "member-write-later",
    code: 'import { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { ADD: "add", REMOVE: "remove", NONE: "none" };\n  actions.ADD = value;\n  const callback = useCallback(() => actions.ADD, []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/member-write-later.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "warning",
  },
  {
    name: "member-compound-write",
    code: 'import { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { ADD: "add", REMOVE: "remove", NONE: "none" };\n  actions.ADD += value;\n  const callback = useCallback(() => actions.ADD, []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/member-compound-write.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "warning",
  },
  {
    name: "member-update",
    code: 'import { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { ADD: "add", REMOVE: "remove", NONE: "none" };\n  actions.ADD++;\n  const callback = useCallback(() => actions.ADD, []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/member-update.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "warning",
  },
  {
    name: "member-delete",
    code: 'import { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { ADD: "add", REMOVE: "remove", NONE: "none" };\n  delete actions.ADD;\n  const callback = useCallback(() => actions.ADD, []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/member-delete.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "warning",
  },
  {
    name: "destructuring-member-write",
    code: 'import { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { ADD: "add", REMOVE: "remove", NONE: "none" };\n  [actions.ADD] = [value];\n  const callback = useCallback(() => actions.ADD, []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/destructuring-member-write.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "warning",
  },
  {
    name: "deferred-member-write",
    code: 'import { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { ADD: "add", REMOVE: "remove", NONE: "none" };\n  const mutate = () => { actions.ADD = value; };\n  useEffect(() => { mutate(); }, [value]);\n  const callback = useCallback(() => actions.ADD, []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/deferred-member-write.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "warning",
  },
  {
    name: "object-assign-mutation",
    code: 'import { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { ADD: "add", REMOVE: "remove", NONE: "none" };\n  Object.assign(actions, { ADD: value });\n  const callback = useCallback(() => actions.ADD, []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/object-assign-mutation.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "warning",
  },
  {
    name: "reflect-set-mutation",
    code: 'import { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { ADD: "add", REMOVE: "remove", NONE: "none" };\n  Reflect.set(actions, "ADD", value);\n  const callback = useCallback(() => actions.ADD, []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/reflect-set-mutation.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "warning",
  },
  {
    name: "alias-and-mutate",
    code: 'import { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { ADD: "add", REMOVE: "remove", NONE: "none" };\n  const alias = actions;\n  alias.ADD = value;\n  const callback = useCallback(() => actions.ADD, []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/alias-and-mutate.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "warning",
  },
  {
    name: "opaque-object-argument",
    code: 'import { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { ADD: "add", REMOVE: "remove", NONE: "none" };\n  consume(actions);\n  const callback = useCallback(() => actions.ADD, []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/opaque-object-argument.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "warning",
  },
  {
    name: "whole-object-callback-capture",
    code: 'import { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { ADD: "add", REMOVE: "remove", NONE: "none" };\n  const callback = useCallback(() => actions, []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/whole-object-callback-capture.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "warning",
  },
  {
    name: "explicit-whole-object-dependency",
    code: 'import { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { ADD: "add", REMOVE: "remove", NONE: "none" };\n  const callback = useCallback(() => actions.ADD, [actions]);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/explicit-whole-object-dependency.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "warning",
  },
  {
    name: "member-call",
    code: 'import { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { ADD: "add", REMOVE: "remove", NONE: "none" };\n  const callback = useCallback(() => actions.ADD(), []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/member-call.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "warning",
  },
  {
    name: "direct-eval-lexical-mutation",
    code: 'import { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { ADD: "add", REMOVE: "remove", NONE: "none" };\n  eval("actions.ADD = String(value)");\n  const callback = useCallback(() => actions.ADD, []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/direct-eval-lexical-mutation.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "warning",
  },
  {
    name: "erased-window-eval-frontier",
    code: 'import { useCallback, useEffect } from "react";\ninterface window {}\nexport const Example = ({ value, other, consume }) => {\n  const actions = { ADD: "add", REMOVE: "remove", NONE: "none" };\n  window.eval("actions.ADD = String(value)");\n  const callback = useCallback(() => actions.ADD, []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/erased-window-eval-frontier.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "warning",
  },
  {
    name: "same-spelling-shadow-mutation",
    code: 'import { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { ADD: "add", REMOVE: "remove", NONE: "none" };\n  const updateOther = () => { const actions = { ADD: "other" }; actions.ADD = value; };\n  const callback = useCallback(() => actions.ADD, []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/same-spelling-shadow-mutation.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "quiet",
  },
  {
    name: "computed-target-read",
    code: 'import { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { ADD: "add", REMOVE: "remove", NONE: "none" };\n  other[actions.ADD] = value;\n  const callback = useCallback(() => actions.ADD, []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/computed-target-read.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "warning",
  },
  {
    name: "optional-member",
    code: 'import { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { ADD: "add", REMOVE: "remove", NONE: "none" };\n  const callback = useCallback(() => actions?.ADD, []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/optional-member.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "warning",
  },
  {
    name: "nested-member-path",
    code: 'import { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { ADD: "add", REMOVE: "remove", NONE: "none" };\n  const callback = useCallback(() => actions.ADD.length, []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/nested-member-path.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "warning",
  },
  {
    name: "jsx-member-use",
    code: 'import { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { ADD: "add", REMOVE: "remove", NONE: "none" };\n  const callback = useCallback(() => <actions.ADD />, []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/jsx-member-use.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "warning",
  },
  {
    name: "inherited-selected-field",
    code: 'import { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = Object.create({ ADD: "add" });\n  const callback = useCallback(() => actions.ADD, []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/inherited-selected-field.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "warning",
  },
  {
    name: "current-member-key-truncation",
    code: 'import { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { current: "add" };\n  const callback = useCallback(() => actions.current, []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/current-member-key-truncation.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "warning",
  },
  {
    name: "record-declared-after-callback",
    code: 'import { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const callback = useCallback(() => actions.ADD, []);\n  const actions = { ADD: "add", REMOVE: "remove", NONE: "none" };\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/record-declared-after-callback.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "warning",
  },
  {
    name: "member-used-as-template-tag",
    code: 'import { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { ADD: "add", REMOVE: "remove", NONE: "none" };\n  const callback = useCallback(() => actions.ADD`next`, []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/member-used-as-template-tag.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "warning",
  },
  {
    name: "member-used-as-constructor",
    code: 'import { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { ADD: "add", REMOVE: "remove", NONE: "none" };\n  const callback = useCallback(() => new actions.ADD(), []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/member-used-as-constructor.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "warning",
  },
  {
    name: "whole-type-only-react-hook-runtime-use",
    code: 'import type { useCallback } from "react";\nimport { useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { ADD: "add", REMOVE: "remove", NONE: "none" };\n  const callback = useCallback(() => actions.ADD, []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/whole-type-only-react-hook-runtime-use.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "warning",
  },
  {
    name: "inline-type-only-react-hook-runtime-use",
    code: 'import { type useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { ADD: "add", REMOVE: "remove", NONE: "none" };\n  const callback = useCallback(() => actions.ADD, []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/inline-type-only-react-hook-runtime-use.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "warning",
  },
  {
    name: "visible-react-namespace-provider-replacement",
    code: 'import React, { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { ADD: "add", REMOVE: "remove", NONE: "none" };\n  React.__defineGetter__("useCallback", () => consume);\n  const callback = useCallback(() => actions.ADD, []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename:
        "/synthetic/readonly-literal-member/visible-react-namespace-provider-replacement.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "warning",
  },
  {
    name: "native-named-hook-and-readonly-react-namespace",
    code: 'import React, { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  React.createRef();\n  React.forwardRef(() => null);\n  const actions = { ADD: "add", REMOVE: "remove", NONE: "none" };\n  const callback = useCallback(() => actions.ADD, []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename:
        "/synthetic/readonly-literal-member/native-named-hook-and-readonly-react-namespace.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "quiet",
  },
  {
    name: "old-unused-dependency-becomes-visible",
    code: 'import { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { ADD: "add", REMOVE: "remove", NONE: "none" };\n  const helper = useCallback(() => other, [other]);\n  const callback = useCallback(() => actions.ADD, [helper]);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/old-unused-dependency-becomes-visible.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "unused-helper",
  },
  {
    name: "unsafe-prototype-special-key",
    code: 'import { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { ADD: "add", __proto__: "ignored-by-native-prototype-setter" };\n  const callback = useCallback(() => actions.ADD, []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/unsafe-prototype-special-key.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "warning",
  },
  {
    name: "named-default-react-namespace-provider-replacement",
    code: 'import { default as React, useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  const actions = { ADD: "add", REMOVE: "remove", NONE: "none" };\n  React.__defineGetter__("useCallback", () => consume);\n  const callback = useCallback(() => actions.ADD, []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename:
        "/synthetic/readonly-literal-member/named-default-react-namespace-provider-replacement.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "warning",
  },
  {
    name: "erased-hook-keeps-reactive-member-warning",
    code: 'import { useCallback, useEffect } from "react";\n\nexport const Example = ({ value, other, consume }) => {\n  interface useCallback {}\n  const actions = { ADD: value };\n  const callback = useCallback(() => actions.ADD, []);\n  return <button onClick={callback}>Run</button>;\n};\n',
    options: {
      filename: "/synthetic/readonly-literal-member/erased-hook-keeps-reactive-member-warning.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectation: "warning",
  },
];

describe("exhaustive-deps closed own string members", () => {
  it.each(closedStringMemberCases)("$name", ({ code, options, expectation }) => {
    const result = runRule(exhaustiveDeps, code, options);
    expect(result.parseErrors).toEqual([]);
    if (expectation === "quiet") {
      expect(result.diagnostics).toEqual([]);
    } else if (expectation === "other-reactive") {
      expect(result.diagnostics.some(({ message }) => message.includes("`value`"))).toBe(true);
      expect(result.diagnostics.some(({ message }) => message.includes("actions.ADD"))).toBe(false);
    } else if (expectation === "unused-helper") {
      expect(
        result.diagnostics.some(
          ({ message }) => message.includes("`helper`") && message.includes("never uses it"),
        ),
      ).toBe(true);
    } else {
      expect(result.diagnostics.some(({ message }) => message.includes("actions"))).toBe(true);
    }
  });
});
