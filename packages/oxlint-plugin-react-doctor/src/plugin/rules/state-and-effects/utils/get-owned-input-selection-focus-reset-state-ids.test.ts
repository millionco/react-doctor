import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../../test-utils/run-rule.js";
import type { RunRuleResult } from "../../../../test-utils/run-rule.js";
import { defineRule } from "../../../utils/define-rule.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getEffectCallback } from "../../../utils/get-effect-callback.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { collectUseStateBindings } from "./collect-use-state-bindings.js";
import { getOwnedInputSelectionFocusResetStateIds } from "./get-owned-input-selection-focus-reset-state-ids.js";
import { noEffectChain } from "../no-effect-chain.js";

interface PrefixFixture {
  readonly name: string;
  readonly source: string;
  readonly expected: readonly string[];
  readonly files?: Readonly<Record<string, string>>;
}

const certificateProbe = defineRule({
  id: "owned-input-selection-focus-reset-probe",
  title: "Owned selection reset probe",
  severity: "warn",
  recommendation: "Use the finite selection ownership contract",
  create: (context) => ({
    CallExpression: (node) => {
      if (!isReactApiCall(node, "useEffect", context.scopes, { resolveNamedAliases: true })) return;
      const component = findEnclosingFunction(node);
      const callback = getEffectCallback(node, context.scopes);
      if (!callback || !isFunctionLike(component)) return;
      const states = collectUseStateBindings(component.body, context.scopes);
      const identifiers = getOwnedInputSelectionFocusResetStateIds(callback, node, context, states);
      for (const state of states) {
        if (!isNodeOfType(state.declarator.id, "ArrayPattern")) continue;
        const [identifier] = state.declarator.id.elements;
        if (!isNodeOfType(identifier, "Identifier")) continue;
        const symbol = context.scopes.symbolFor(identifier);
        if (symbol && identifiers.has(symbol.id))
          context.report({ node, message: state.valueName });
      }
    },
  }),
});

const baseSource = `
import { useEffect, useRef, useState } from 'react';
const EMPTY_POSITION = -3;
function ChoiceField({ entries = [], onPick = () => {}, enabled = true }) {
  const [chosen, setChosen] = useState('');
  const [choices, setChoices] = useState(entries);
  const [opened, setOpened] = useState(false);
  const [position, setPosition] = useState(EMPTY_POSITION);
  const [other, setOther] = useState(0);
  const [total, setTotal] = useState(0);
  const wrapper = useRef(null);
  const field = useRef(null);
  const finish = () => {
    const target = field.current;
    if (target) {
      target.focus();
      setPosition(EMPTY_POSITION);
    }
  };
  useEffect(() => { setPosition(2); }, [entries]);
  useEffect(() => {
    if (opened && position !== EMPTY_POSITION && enabled) {
      setChosen(choices[position]);
      onPick(choices[position]);
      setOpened(false);
      finish();
    }
  }, [position, other]);
  return <div ref={wrapper}><label>Choice</label><input ref={field} value={chosen} onChange={event => setChosen(event.target.value)} /></div>;
}
`;

const change = (source: string, previous: string, next: string): string => {
  expect(source.split(previous)).toHaveLength(2);
  return source.replace(previous, next);
};

const runFixture = (fixture: PrefixFixture, integration = false): RunRuleResult => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "owned-selection-prefix-"));
  try {
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "invented-selection-fixture",
        private: true,
        dependencies: { react: "18.2.0", "react-dom": "18.2.0", "styled-components": "5.3.11" },
      }),
    );
    for (const [relativePath, content] of Object.entries(fixture.files ?? {})) {
      const destination = path.join(root, relativePath);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, content);
    }
    const filename = path.join(root, "choice-field.tsx");
    fs.writeFileSync(filename, fixture.source);
    return runRule(integration ? noEffectChain : certificateProbe, fixture.source, { filename });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const mutation = (name: string, previous: string, next: string): PrefixFixture => ({
  name,
  source: change(baseSource, previous, next),
  expected: [],
});

const namedCallbackSource = change(
  change(
    baseSource,
    "  useEffect(() => {\n    if (opened",
    "  const selectionEffect = () => {\n    if (opened",
  ),
  "  }, [position, other]);",
  "  };\n  useEffect(selectionEffect, [position, other]);",
);

const fixtures: readonly PrefixFixture[] = [
  { name: "direct native selection", source: baseSource, expected: ["position"] },
  {
    name: "readonly same-component named const effect callback",
    source: namedCallbackSource,
    expected: ["position"],
  },
  {
    name: "readonly same-component function declaration effect callback",
    source: change(
      namedCallbackSource,
      "const selectionEffect = () =>",
      "function selectionEffect()",
    ),
    expected: ["position"],
  },
  {
    name: "named callback escaping to another consumer",
    source: change(
      namedCallbackSource,
      "  useEffect(selectionEffect,",
      "  retain(selectionEffect); useEffect(selectionEffect,",
    ),
    expected: [],
  },
  {
    name: "named callback binding reassigned",
    source: change(
      change(namedCallbackSource, "const selectionEffect =", "let selectionEffect ="),
      "  useEffect(selectionEffect,",
      "  selectionEffect = () => {}; useEffect(selectionEffect,",
    ),
    expected: [],
  },
  {
    name: "named callback reused by another effect",
    source: change(
      namedCallbackSource,
      "  useEffect(selectionEffect,",
      "  useEffect(selectionEffect, []); useEffect(selectionEffect,",
    ),
    expected: [],
  },
  {
    name: "named callback alias is outside exact argument binding",
    source: change(
      namedCallbackSource,
      "  useEffect(selectionEffect,",
      "  const aliasEffect = selectionEffect; useEffect(aliasEffect,",
    ),
    expected: [],
  },
  {
    name: "named callback with executable default remains unsupported",
    source: change(
      namedCallbackSource,
      "const selectionEffect = () =>",
      "const selectionEffect = (value = compute()) =>",
    ),
    expected: [],
  },
  {
    name: "async named callback remains unsupported",
    source: change(
      namedCallbackSource,
      "const selectionEffect = () =>",
      "const selectionEffect = async () =>",
    ),
    expected: [],
  },
  {
    name: "optional selection pair",
    source: change(
      baseSource,
      "      setChosen(choices[position]);\n      onPick(choices[position]);",
      "      if (position !== EMPTY_POSITION) { setChosen(choices[position]); onPick(choices[position]); }",
    ),
    expected: ["position"],
  },
  {
    name: "readonly range prelude and native ancestor contains",
    source: change(
      baseSource,
      "    if (opened && position !== EMPTY_POSITION && enabled)",
      "    const inRange = position >= 0 && position < choices.length;\n    if (opened && inRange && enabled && wrapper.current?.contains(document.activeElement))",
    ),
    expected: ["position"],
  },
  {
    name: "fixed second native child",
    source: change(
      baseSource,
      "const target = field.current;",
      "const target = wrapper.current?.children[1];",
    ),
    expected: ["position"],
  },
  {
    name: "transparent target and payload wrappers",
    source: change(
      change(
        baseSource,
        "const target = field.current;",
        "const target = ((field.current) as HTMLInputElement | null);",
      ),
      "onPick(choices[position]);",
      "onPick(((choices[position]) as string));",
    ),
    expected: ["position"],
  },
  {
    name: "numeric sentinel alias",
    source: change(
      baseSource,
      "const EMPTY_POSITION = -3;",
      "const INITIAL_CHOICE = -3; const EMPTY_POSITION = INITIAL_CHOICE;",
    ),
    expected: ["position"],
  },
  {
    name: "literal void and empty noops",
    source: change(
      change(
        baseSource,
        "    const target = field.current;",
        "    ; void 0; const target = field.current;",
      ),
      "      setOpened(false);",
      "      ; void 0; setOpened(false);",
    ),
    expected: ["position"],
  },
  {
    name: "styled input through a named barrel",
    source: change(
      change(
        baseSource,
        "const EMPTY_POSITION = -3;",
        "import styled from 'styled-components'; import { BaseField } from './parts'; const StyledField = styled(BaseField)``; const EMPTY_POSITION = -3;",
      ),
      "<input ref={field} value={chosen}",
      "<StyledField ref={field} value={chosen}",
    ),
    files: {
      "parts/index.ts": "import BaseField from './base-field'; export { BaseField };",
      "parts/base-field.tsx":
        "import styled from 'styled-components'; const BaseField = styled.input.attrs(({theme, ...rest}) => ({theme: {...theme}, skin: 'plain', ...rest}))``; export default BaseField;",
    },
    expected: ["position"],
  },
  {
    name: "ordinary React effect dependency read of the options state",
    source: change(
      baseSource,
      "  return <div ref={wrapper}>",
      "  useEffect(() => { setOther(choices.length); }, [choices]); return <div ref={wrapper}>",
    ),
    expected: ["position"],
  },
  mutation(
    "same-state derived total beside focus reset",
    "      setChosen(choices[position]);\n      onPick(choices[position]);",
    "      setTotal(position * 5);",
  ),
  mutation(
    "wrong controlled state setter",
    "setChosen(choices[position]);",
    "setTotal(choices[position]);",
  ),
  mutation(
    "callback receives different index",
    "onPick(choices[position]);",
    "onPick(choices[other]);",
  ),
  mutation(
    "callback receives different option state",
    "onPick(choices[position]);",
    "onPick(entries[position]);",
  ),
  mutation(
    "payload transform",
    "setChosen(choices[position]);",
    "setChosen(String(choices[position]));",
  ),
  mutation("controlled value mismatch", "value={chosen}", "value={total}"),
  mutation("extra state setter", "      finish();", "      setTotal(position); finish();"),
  mutation("extra callback", "      finish();", "      onPick(position); finish();"),
  mutation("work after focus reset", "      finish();", "      finish(); setTotal(position);"),
  mutation("side effecting void", "      finish();", "      void onPick(position); finish();"),
  mutation("asynchronous helper", "const finish = () =>", "const finish = async () =>"),
  mutation(
    "helper parameter default",
    "const finish = () =>",
    "const finish = (unused = onPick(position)) =>",
  ),
  mutation(
    "helper extraction",
    "  useEffect(() => { setPosition(2); },",
    "  register(finish); useEffect(() => { setPosition(2); },",
  ),
  mutation(
    "helper assignment",
    "  useEffect(() => { setPosition(2); },",
    "  finish = () => {}; useEffect(() => { setPosition(2); },",
  ),
  mutation("helper rebound lexical binding", "const finish = () =>", "let finish = () =>"),
  mutation("helper early return", "      target.focus();", "      return; target.focus();"),
  mutation("reset different initial sentinel", "setPosition(EMPTY_POSITION);", "setPosition(0);"),
  mutation("reset other state", "setPosition(EMPTY_POSITION);", "setOther(EMPTY_POSITION);"),
  mutation(
    "reset before focus",
    "      target.focus();\n      setPosition(EMPTY_POSITION);",
    "      setPosition(EMPTY_POSITION); target.focus();",
  ),
  mutation("executable callback default", "onPick = () => {}", "onPick = () => foreign()"),
  mutation(
    "callback binding reassigned",
    "  const wrapper = useRef(null);",
    "  onPick = value => setTotal(value); const wrapper = useRef(null);",
  ),
  mutation(
    "callback replaced by local helper",
    "onPick(choices[position]);",
    "setOther(choices[position]);",
  ),
  mutation(
    "setter binding write",
    "  const wrapper = useRef(null);",
    "  setChosen = setTotal; const wrapper = useRef(null);",
  ),
  mutation("mutable state tuple", "const [position, setPosition]", "let [position, setPosition]"),
  mutation(
    "unbound useState",
    "import { useEffect, useRef, useState }",
    "import { useEffect, useRef }",
  ),
  mutation(
    "visibility initially true",
    "[opened, setOpened] = useState(false)",
    "[opened, setOpened] = useState(true)",
  ),
  mutation("negated visibility guard", "if (opened && position", "if (!opened && position"),
  mutation("visibility only disjunction", "if (opened && position", "if (opened || position"),
  mutation("does not close visibility", "setOpened(false);", "setOpened(true);"),
  mutation("unrelated guard call", "&& enabled) {", "&& decide(position)) {"),
  mutation(
    "readonly object coercion",
    "    if (opened && position !== EMPTY_POSITION && enabled)",
    "    const threshold = { valueOf() { setTotal(position); return 0; } }; if (opened && position >= threshold && enabled)",
  ),
  {
    name: "readonly component object coercion",
    source: change(
      change(
        baseSource,
        "  const wrapper = useRef(null);",
        "  const threshold = { valueOf() { setTotal(position); return 0; } }; const wrapper = useRef(null);",
      ),
      "position !== EMPTY_POSITION && enabled",
      "position >= threshold && enabled",
    ),
    expected: [],
  },
  mutation(
    "executable guard prelude",
    "    if (opened && position",
    "    const ready = onPick(position); if (opened && position",
  ),
  mutation(
    "uncovered work branch",
    "      finish();\n    }",
    "      finish();\n    } else { setTotal(position); }",
  ),
  mutation(
    "extra independent branch",
    "      finish();\n    }",
    "      finish();\n    } if (enabled) { setTotal(position); }",
  ),
  mutation("deferred focus reset", "      finish();", "      setTimeout(finish, 1);"),
  mutation(
    "native ref method overwritten",
    "  useEffect(() => { setPosition(2); },",
    "  field.current.focus = () => {}; useEffect(() => { setPosition(2); },",
  ),
  mutation(
    "native ancestor contains overwritten",
    "  useEffect(() => { setPosition(2); },",
    "  wrapper.current.contains = () => true; useEffect(() => { setPosition(2); },",
  ),
  mutation("input polymorphism", "<input ref={field}", "<input $as={CustomField} ref={field}"),
  mutation(
    "input value spread",
    "value={chosen} onChange",
    "value={chosen} {...extraProps} onChange",
  ),
  mutation(
    "input duplicate value",
    "value={chosen} onChange",
    "value={chosen} value={total} onChange",
  ),
  mutation(
    "selected option accessor initializer",
    "useState(entries);",
    "useState({ get 0() { setTotal(position); return 'changed'; } });",
  ),
  mutation(
    "selected option accessor mutation",
    "  const wrapper = useRef(null);",
    "  Object.defineProperty(choices, '0', {get() { setTotal(position); return 'changed'; }}); const wrapper = useRef(null);",
  ),
  mutation(
    "selected option borrowed container",
    "  const wrapper = useRef(null);",
    "  configure(choices); const wrapper = useRef(null);",
  ),
  mutation(
    "selected option in-place reorder",
    "  const wrapper = useRef(null);",
    "  choices.reverse(); const wrapper = useRef(null);",
  ),
  mutation(
    "options passed in an arbitrary array",
    "  const wrapper = useRef(null);",
    "  consume([choices]); const wrapper = useRef(null);",
  ),
  mutation(
    "options in a non-React effect dependency array",
    "  const wrapper = useRef(null);",
    "  watch(() => {}, [choices]); const wrapper = useRef(null);",
  ),
  mutation(
    "own options producer returns an indexed getter",
    "  const wrapper = useRef(null);",
    "  const makeChoices = () => ({ get 0() { setTotal(position); return 'changed'; }, length: 1 }); setChoices(makeChoices()); const wrapper = useRef(null);",
  ),
  mutation(
    "own options producer installs an indexed accessor",
    "  const wrapper = useRef(null);",
    "  const makeChoices = () => { const result = []; Object.defineProperty(result, '0', {get() { setTotal(position); return 'changed'; }}); return result; }; setChoices(makeChoices()); const wrapper = useRef(null);",
  ),
  mutation(
    "destructured option slot assignment",
    "  const wrapper = useRef(null);",
    "  [choices[0]] = entries; const wrapper = useRef(null);",
  ),
  mutation(
    "for-of option slot assignment",
    "  const wrapper = useRef(null);",
    "  for (choices[0] of entries) {} const wrapper = useRef(null);",
  ),
  mutation(
    "index state receives a coercing object",
    "setPosition(2);",
    "setPosition({ valueOf() { setTotal(1); return 0; } });",
  ),
  mutation(
    "index state receives an own object alias",
    "  const wrapper = useRef(null);",
    "  const nextPosition = { valueOf() { setTotal(1); return 0; } }; setPosition(nextPosition); const wrapper = useRef(null);",
  ),
  mutation(
    "named useState provider reassigned",
    "const EMPTY_POSITION = -3;",
    "useState = foreign; const EMPTY_POSITION = -3;",
  ),
  mutation(
    "named useEffect provider reassigned",
    "const EMPTY_POSITION = -3;",
    "useEffect = foreign; const EMPTY_POSITION = -3;",
  ),
  mutation(
    "mixed namespace useState provider replaced",
    "const EMPTY_POSITION = -3;",
    "import React from 'react'; React.useState = foreign; const EMPTY_POSITION = -3;",
  ),
  mutation(
    "mixed namespace useEffect provider replaced",
    "const EMPTY_POSITION = -3;",
    "import React from 'react'; React.useEffect = foreign; const EMPTY_POSITION = -3;",
  ),
  {
    name: "numeric sentinel distinguishes signed zero",
    source: change(
      change(baseSource, "const EMPTY_POSITION = -3;", "const EMPTY_POSITION = -0;"),
      "setPosition(EMPTY_POSITION);",
      "setPosition(0);",
    ),
    expected: [],
  },
  {
    name: "readonly numeric ternary index producer",
    source: change(
      baseSource,
      "useEffect(() => { setPosition(2); }, [entries]);",
      "useEffect(() => { const nextPosition = position < choices.length ? position + 1 : position; setPosition(nextPosition); }, [entries]);",
    ),
    expected: ["position"],
  },
  mutation(
    "own options identity return is unsupported",
    "  const wrapper = useRef(null);",
    "  const passthrough = value => value; setChoices(passthrough({ get 0() { setTotal(position); return 'changed'; }, length: 1 })); const wrapper = useRef(null);",
  ),
  mutation(
    "nested options identity returns are unsupported",
    "  const wrapper = useRef(null);",
    "  const passthrough = value => value; setChoices(passthrough(passthrough({ get 0() { setTotal(position); return 'changed'; }, length: 1 }))); const wrapper = useRef(null);",
  ),
  mutation(
    "options filter method replaced",
    "  const wrapper = useRef(null);",
    "  entries.filter = () => ({ get 0() { setTotal(position); return 'changed'; }, length: 1 }); const makeChoices = text => entries.filter(entry => entry.includes(text)); setChoices(makeChoices(chosen)); const wrapper = useRef(null);",
  ),
  mutation(
    "options filter receiver escapes",
    "  const wrapper = useRef(null);",
    "  configure(entries); const makeChoices = text => entries.filter(entry => entry.includes(text)); setChoices(makeChoices(chosen)); const wrapper = useRef(null);",
  ),
  {
    name: "ordinary own filtered array producer",
    source: change(
      baseSource,
      "  const wrapper = useRef(null);",
      "  const filterChoices = text => entries.filter(entry => entry.includes(text)); const updateChoices = () => { const nextChoices = filterChoices(chosen); setChoices(nextChoices); }; const wrapper = useRef(null);",
    ),
    expected: ["position"],
  },
  mutation(
    "filter source borrowed through another state initializer",
    "  const wrapper = useRef(null);",
    "  const [borrowed] = useState(entries); borrowed.filter = () => ({ get 0() { setTotal(position); return 'changed'; }, length: 1 }); const filterChoices = text => entries.filter(entry => entry.includes(text)); setChoices(filterChoices(chosen)); const wrapper = useRef(null);",
  ),
  mutation(
    "filter source borrowed through another state setter",
    "  const wrapper = useRef(null);",
    "  const [borrowed, setBorrowed] = useState([]); setBorrowed(entries); borrowed.filter = () => ({ get 0() { setTotal(position); return 'changed'; }, length: 1 }); const filterChoices = text => entries.filter(entry => entry.includes(text)); setChoices(filterChoices(chosen)); const wrapper = useRef(null);",
  ),
  mutation(
    "unmutated other state borrow is outside selected ownership",
    "  const wrapper = useRef(null);",
    "  const [borrowed] = useState(entries); const filterChoices = text => entries.filter(entry => entry.includes(text)); setChoices(filterChoices(chosen)); const wrapper = useRef(null);",
  ),
  mutation(
    "initial parameter source has an indexed accessor",
    "  const wrapper = useRef(null);",
    "  Object.defineProperty(entries, '0', { get() { setTotal(position); return 'changed'; } }); const wrapper = useRef(null);",
  ),
  mutation(
    "initial parameter source escapes",
    "  const wrapper = useRef(null);",
    "  configure(entries); const wrapper = useRef(null);",
  ),
  {
    name: "direct setter parameter source has an indexed accessor",
    source: change(
      change(baseSource, "enabled = true", "enabled = true, otherEntries = []"),
      "  const wrapper = useRef(null);",
      "  Object.defineProperty(otherEntries, '0', { get() { setTotal(position); return 'changed'; } }); setChoices(otherEntries); const wrapper = useRef(null);",
    ),
    expected: [],
  },
  mutation(
    "nested helper parameter source is unsupported",
    "  const wrapper = useRef(null);",
    "  const replaceChoices = values => setChoices(values); replaceChoices(entries); const wrapper = useRef(null);",
  ),
  {
    name: "selected direct parameter setter retains ownership",
    source: change(
      baseSource,
      "  const wrapper = useRef(null);",
      "  setChoices(entries); const wrapper = useRef(null);",
    ),
    expected: ["position"],
  },
  mutation(
    "own array source installs an accessor",
    "  const wrapper = useRef(null);",
    "  const nextChoices = []; Object.defineProperty(nextChoices, '0', { get() { setTotal(position); return 'changed'; } }); setChoices(nextChoices); const wrapper = useRef(null);",
  ),
  mutation(
    "own array source escapes before selected setter",
    "  const wrapper = useRef(null);",
    "  const nextChoices = []; configure(nextChoices); setChoices(nextChoices); const wrapper = useRef(null);",
  ),
  mutation(
    "null is not an ordinary options array",
    "  const wrapper = useRef(null);",
    "  setChoices(null); const wrapper = useRef(null);",
  ),
  mutation(
    "primitive alias is not an ordinary options array",
    "  const wrapper = useRef(null);",
    "  const nextChoices = 1; setChoices(nextChoices); const wrapper = useRef(null);",
  ),
  {
    name: "own primitive array result retains selected ownership",
    source: change(
      baseSource,
      "  const wrapper = useRef(null);",
      "  const nextChoices = ['plain']; setChoices(nextChoices); const wrapper = useRef(null);",
    ),
    expected: ["position"],
  },
  {
    name: "declared const array source has no own initializer",
    source: change(
      change(
        baseSource,
        "const EMPTY_POSITION = -3;",
        "declare const unknownChoices: string[]; const EMPTY_POSITION = -3;",
      ),
      "  const wrapper = useRef(null);",
      "  setChoices(unknownChoices); const wrapper = useRef(null);",
    ),
    expected: [],
  },
  mutation(
    "own filter producer cannot borrow a nested parameter",
    "  const wrapper = useRef(null);",
    "  const makeChoices = source => source.filter(entry => true); setChoices(makeChoices({ filter: () => ({ get 0() { setTotal(position); return 'changed'; }, length: 1 }) })); const wrapper = useRef(null);",
  ),
  mutation(
    "selected option logical alias escape",
    "  const wrapper = useRef(null);",
    "  const snapshot = choices || []; snapshot[0] = 'changed'; const wrapper = useRef(null);",
  ),
];

describe("owned input selection focus reset state IDs", () => {
  it("keeps the real rule quiet after extracting the reader effect to a readonly const", () => {
    const result = runFixture(
      { name: "named reader effect", source: namedCallbackSource, expected: [] },
      true,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  for (const fixture of fixtures) {
    it(fixture.name, () => {
      const result = runFixture(fixture);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(fixture.expected);
    });
  }

  it("retains another incoming state edge after excluding the index edge", () => {
    const source = change(
      change(
        baseSource,
        "useEffect(() => { setPosition(2); }, [entries]);",
        "useEffect(() => { setPosition(2); setOther(1); setOpened(true); }, [entries]);",
      ),
      "&& enabled) {",
      "&& enabled && other === 1) {",
    );
    const result = runFixture({ name: "other incoming state", source, expected: [] }, true);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes('"other"'))).toBe(
      true,
    );
  });

  it("retains the downstream derived value edge", () => {
    const source = change(
      baseSource,
      "  return <div ref={wrapper}>",
      "  useEffect(() => { setTotal(chosen.length); }, [chosen]); return <div ref={wrapper}>",
    );
    const result = runFixture({ name: "outgoing chosen edge", source, expected: [] }, true);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes('"chosen"'))).toBe(
      true,
    );
  });
});
