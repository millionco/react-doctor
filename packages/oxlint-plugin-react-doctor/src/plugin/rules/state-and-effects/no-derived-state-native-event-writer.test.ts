import rendererFixtures from "./no-derived-state-native-renderer-fixtures.json";
import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { wrapWithSemanticContext } from "../../utils/wrap-with-semantic-context.js";
import { noDerivedState } from "./no-derived-state.js";
import { noDerivedStateEffect } from "./no-derived-state-effect.js";

interface NativeEventWriterCase {
  name: string;
  reportsPropReseed: boolean;
  code: string;
}

const nativeEventWriterCases: NativeEventWriterCase[] = [
  {
    name: "reports an inactive disabled ancestor spread",
    reportsPropReseed: true,
    code: `import { useEffect, useRef, useState } from "react";
export const Panel = ({ seed }) => {
  const [value, setValue] = useState(seed);
  const writeValue = (nextValue) => setValue(nextValue);
  const latest = useRef({ writeValue });
  latest.current = { writeValue };
  const activate = (event) => { event.preventDefault(); writeValue(!value); };
  useEffect(() => { setValue(seed); }, [seed]);
  return <fieldset {...{disabled:true}}><button onClick={activate}>{String(value)}</button></fieldset>;
};`,
  },
  {
    name: "reports an inactive template ancestor",
    reportsPropReseed: true,
    code: `import { useEffect, useRef, useState } from "react";
export const Panel = ({ seed }) => {
  const [value, setValue] = useState(seed);
  const writeValue = (nextValue) => setValue(nextValue);
  const latest = useRef({ writeValue });
  latest.current = { writeValue };
  const activate = (event) => { event.preventDefault(); writeValue(!value); };
  useEffect(() => { setValue(seed); }, [seed]);
  return <template><button onClick={activate}>{String(value)}</button></template>;
};`,
  },
  {
    name: "reports an inactive iframe ancestor",
    reportsPropReseed: true,
    code: `import { useEffect, useRef, useState } from "react";
export const Panel = ({ seed }) => {
  const [value, setValue] = useState(seed);
  const writeValue = (nextValue) => setValue(nextValue);
  const latest = useRef({ writeValue });
  latest.current = { writeValue };
  const activate = (event) => { event.preventDefault(); writeValue(!value); };
  useEffect(() => { setValue(seed); }, [seed]);
  return <iframe><button onClick={activate}>{String(value)}</button></iframe>;
};`,
  },
  {
    name: "reports when a custom ancestor drops the native control",
    reportsPropReseed: true,
    code: `const Drop=({children})=>null;
import { useEffect, useRef, useState } from "react";
export const Panel = ({ seed }) => {
  const [value, setValue] = useState(seed);
  const writeValue = (nextValue) => setValue(nextValue);
  const latest = useRef({ writeValue });
  latest.current = { writeValue };
  const activate = (event) => { event.preventDefault(); writeValue(!value); };
  useEffect(() => { setValue(seed); }, [seed]);
  return <Drop><button onClick={activate}>{String(value)}</button></Drop>;
};`,
  },
  {
    name: "retains an intrinsic ancestor around the native control",
    reportsPropReseed: false,
    code: `import { useEffect, useRef, useState } from "react";
export const Panel = ({ seed }) => {
  const [value, setValue] = useState(seed);
  const writeValue = (nextValue) => setValue(nextValue);
  const latest = useRef({ writeValue });
  latest.current = { writeValue };
  const activate = (event) => { event.preventDefault(); writeValue(!value); };
  useEffect(() => { setValue(seed); }, [seed]);
  return <section><button onClick={activate}>{String(value)}</button></section>;
};`,
  },
  {
    name: "retains the runtime TypeScript enum fence",
    reportsPropReseed: true,
    code: `import { useEffect, useRef, useState } from "react";
enum RuntimeMode { Active }
export const Panel = ({ seed }) => {
  const [value, setValue] = useState(seed);
  const writeValue = (nextValue) => setValue(nextValue);
  const latest = useRef({ writeValue });
  latest.current = { writeValue };
  const activate = () => writeValue(!value);
  useEffect(() => { setValue(seed); }, [seed]);
  return <button onClick={activate}>{String(value)}</button>;
};`,
  },
  {
    name: "ignores erased destructured type parameters in the runtime prop census",
    reportsPropReseed: false,
    code: `import { useEffect, useRef, useState } from "react";
interface PanelSlots { render?: ({ seed }: { seed: boolean }) => unknown; }
export const Panel = ({ seed, onValueChange }) => {
  const [value, setValue] = useState(seed);
  const controlled = seed !== undefined && onValueChange !== undefined;
  const displayedValue = controlled ? Boolean(seed) : value;
  const writeValue = (nextValue) => { if (!controlled) setValue(nextValue); onValueChange?.(nextValue); };
  const latest = useRef({ writeValue });
  latest.current = { writeValue };
  const activate = () => writeValue(!displayedValue);
  useEffect(() => { setValue(seed); }, [seed]);
  return <button onClick={activate}>{String(displayedValue)}</button>;
};`,
  },
  {
    name: "retains runtime prop mutations inside transparent type assertions",
    reportsPropReseed: true,
    code: `import { useEffect, useRef, useState } from "react";
interface PanelSlots { render?: ({ seed }: { seed: boolean }) => unknown; }
export const Panel = ({ seed, onValueChange }) => {
  const [value, setValue] = useState(seed);
  const controlled = seed !== undefined && onValueChange !== undefined;
  const displayedValue = controlled ? Boolean(seed) : value;
  const changedSeed = ((seed = undefined) as boolean | undefined);
  const writeValue = (nextValue) => { if (!controlled) setValue(nextValue); onValueChange?.(nextValue); };
  const latest = useRef({ writeValue });
  latest.current = { writeValue };
  const activate = () => writeValue(!displayedValue);
  useEffect(() => { setValue(seed); }, [seed]);
  return <button onClick={activate}>{String(displayedValue)}</button>;
};`,
  },
  {
    name: "retains an odd own-state toggle through a ref-stored writer",
    reportsPropReseed: false,
    code: `import { useEffect, useRef, useState } from "react";
export const Panel = ({ seed }) => {
  const [value, setValue] = useState(seed);
  const writeValue = (nextValue) => setValue(nextValue);
  const latest = useRef({ writeValue });
  latest.current = { writeValue };
  const activate = (event) => { event.preventDefault(); writeValue(!value); };
  useEffect(() => { setValue(seed); }, [seed]);
  return <button onClick={activate}>{String(value)}</button>;
};`,
  },
  {
    name: "retains a triple-negated toggle through plain object storage",
    reportsPropReseed: false,
    code: `import { useEffect, useRef, useState } from "react";
export const Panel = ({ seed }) => {
  const [value, setValue] = useState(seed);
  const writeValue = (nextValue) => setValue(nextValue);
  const stored = { writeValue };
  const latest = useRef(stored);
  const activate = () => { writeValue(!!!value); };
  useEffect(() => { setValue(seed); }, [seed]);
  return <button onClick={activate}>{String(value)}</button>;
};`,
  },
  {
    name: "retains a toggle through an immutable own-state alias",
    reportsPropReseed: false,
    code: `import { useEffect, useRef, useState } from "react";
export const Panel = ({ seed }) => {
  const [value, setValue] = useState(seed);
  const displayedValue = value;
  const writeValue = (nextValue) => setValue(nextValue);
  const latest = useRef({ writeValue });
  latest.current = { writeValue };
  const activate = () => { writeValue(!displayedValue); };
  useEffect(() => { setValue(seed); }, [seed]);
  return <button onClick={activate}>{String(value)}</button>;
};`,
  },
  {
    name: "retains the optional controlled callback and local fallback",
    reportsPropReseed: false,
    code: `import { useEffect, useRef, useState } from "react";
export const Panel = ({ seed, onValueChange }) => {
  const [value, setValue] = useState(seed);
  const controlled = seed !== undefined && onValueChange !== undefined;
  const displayedValue = controlled ? Boolean(seed) : value;
  const writeValue = (nextValue) => {
    if (!controlled) setValue(nextValue);
    onValueChange?.(nextValue);
  };
  const latest = useRef({ writeValue });
  latest.current = { writeValue };
  const activate = (event) => { event.preventDefault(); writeValue(!displayedValue); };
  useEffect(() => { setValue(seed); }, [seed]);
  return <button onClick={activate}>{String(displayedValue)}</button>;
};`,
  },
  {
    name: "retains the genuine context opposite arm with an unrelated host gate",
    reportsPropReseed: false,
    code: `import { useContext, useEffect, useRef, useState } from "react";
import { DraftContext } from "./draft-context.js";
export const Panel = ({ seed, onValueChange, label }) => {
  const [value, setValue] = useState(seed);
  const parent = useContext(DraftContext);
  const controlled = seed !== undefined && onValueChange !== undefined;
  const displayedValue = controlled ? Boolean(seed) : parent ? parent.active : value;
  const writeValue = (nextValue) => {
    if (!controlled) {
      if (parent) parent.publish(nextValue);
      else setValue(nextValue);
    }
    onValueChange?.(nextValue);
  };
  const latest = useRef({ writeValue });
  latest.current = { writeValue };
  const activate = (event) => { event.preventDefault(); writeValue(!displayedValue); };
  useEffect(() => { setValue(seed); }, [seed]);
  return label && <button onClick={activate}>{String(displayedValue)}</button>;
};`,
  },
  {
    name: "reports a same-snapshot write",
    reportsPropReseed: true,
    code: `import { useEffect, useRef, useState } from "react";
export const Panel = ({ seed }) => {
  const [value, setValue] = useState(seed);
  const writeValue = (nextValue) => setValue(nextValue);
  const latest = useRef({ writeValue });
  latest.current = { writeValue };
  const activate = () => { writeValue(value); };
  useEffect(() => { setValue(seed); }, [seed]);
  return <button onClick={activate}>{String(value)}</button>;
};`,
  },
  {
    name: "reports an even-negated own-state payload",
    reportsPropReseed: true,
    code: `import { useEffect, useRef, useState } from "react";
export const Panel = ({ seed }) => {
  const [value, setValue] = useState(seed);
  const writeValue = (nextValue) => setValue(nextValue);
  const latest = useRef({ writeValue });
  latest.current = { writeValue };
  const activate = () => { writeValue(!!value); };
  useEffect(() => { setValue(seed); }, [seed]);
  return <button onClick={activate}>{String(value)}</button>;
};`,
  },
  {
    name: "reports a payload from a different state pair",
    reportsPropReseed: true,
    code: `import { useEffect, useRef, useState } from "react";
export const Panel = ({ seed }) => {
  const [value, setValue] = useState(seed);
  const [otherValue] = useState(false);
  const writeValue = (nextValue) => setValue(nextValue);
  const latest = useRef({ writeValue });
  latest.current = { writeValue };
  const activate = () => { writeValue(!otherValue); };
  useEffect(() => { setValue(seed); }, [seed]);
  return <button onClick={activate}>{String(value)}</button>;
};`,
  },
  {
    name: "keeps reporting a full name derived only from props",
    reportsPropReseed: true,
    code: `import { useEffect, useRef, useState } from "react";
export const FullName = ({ firstName, lastName }) => {
  const [value, setValue] = useState("");
  const writeValue = (nextValue) => setValue(nextValue);
  const latest = useRef({ writeValue });
  latest.current = { writeValue };
  const activate = () => { writeValue(firstName + " " + lastName); };
  useEffect(() => { setValue(firstName + " " + lastName); }, [firstName, lastName]);
  return <button onClick={activate}>{value}</button>;
};`,
  },
  {
    name: "reports when the writer parameter contradicts the supplied flag",
    reportsPropReseed: true,
    code: `import { useEffect, useRef, useState } from "react";
export const Panel = ({ seed }) => {
  const [value, setValue] = useState(seed);
  const writeValue = (nextValue, blocked) => { if (!blocked) setValue(nextValue); };
  const latest = useRef({ writeValue });
  latest.current = { writeValue };
  const activate = () => { writeValue(!value, true); };
  useEffect(() => { setValue(seed); }, [seed]);
  return <button onClick={activate}>{String(value)}</button>;
};`,
  },
  {
    name: "reports when caller and writer require opposite guards",
    reportsPropReseed: true,
    code: `import { useEffect, useRef, useState } from "react";
export const Panel = ({ seed, blocked }) => {
  const [value, setValue] = useState(seed);
  const writeValue = (nextValue) => { if (!blocked) setValue(nextValue); };
  const latest = useRef({ writeValue });
  latest.current = { writeValue };
  const activate = () => { if (blocked) writeValue(!value); };
  useEffect(() => { setValue(seed); }, [seed]);
  return <button onClick={activate}>{String(value)}</button>;
};`,
  },
  {
    name: "reports a batched toggle followed by snapshot restoration",
    reportsPropReseed: true,
    code: `import { useEffect, useRef, useState } from "react";
export const Panel = ({ seed }) => {
  const [value, setValue] = useState(seed);
  const writeValue = (nextValue) => setValue(nextValue);
  const latest = useRef({ writeValue });
  latest.current = { writeValue };
  const activate = () => { writeValue(!value); writeValue(value); };
  useEffect(() => { setValue(seed); }, [seed]);
  return <button onClick={activate}>{String(value)}</button>;
};`,
  },
  {
    name: "reports a replaced context method that restores the snapshot",
    reportsPropReseed: true,
    code: `import { useContext, useEffect, useRef, useState } from "react";
import { DraftContext } from "./draft-context.js";
export const Panel = ({ seed, onValueChange, label }) => {
  const [value, setValue] = useState(seed);
  const parent = useContext(DraftContext);
  const controlled = seed !== undefined && onValueChange !== undefined;
  const displayedValue = controlled ? Boolean(seed) : parent ? parent.active : value;
  const writeValue = (nextValue) => {
    if (!controlled) {
      setValue(nextValue);
      if (nextValue) parent.publish(value);
    }
    onValueChange?.(nextValue);
  };
  const latest = useRef({ writeValue });
  latest.current = { writeValue };
  if (parent) parent.publish = writeValue;
  const activate = (event) => { event.preventDefault(); writeValue(!displayedValue); };
  useEffect(() => { setValue(seed); }, [seed]);
  return label && <button onClick={activate}>{String(displayedValue)}</button>;
};`,
  },
  {
    name: "reports complementary early returns before the setter",
    reportsPropReseed: true,
    code: `import { useEffect, useRef, useState } from "react";
export const Panel = ({ seed }) => {
  const [value, setValue] = useState(seed);
  const writeValue = (nextValue) => { if (nextValue) return; if (!nextValue) return; setValue(nextValue); };
  const latest = useRef({ writeValue });
  latest.current = { writeValue };
  const activate = (event) => { event.preventDefault(); writeValue(!value); };
  useEffect(() => { setValue(seed); }, [seed]);
  return <button onClick={activate}>{String(value)}</button>;
};`,
  },
  {
    name: "reports when the selected native control is disabled",
    reportsPropReseed: true,
    code: `import { useEffect, useRef, useState } from "react";
export const Panel = ({ seed }) => {
  const [value, setValue] = useState(seed);
  const writeValue = (nextValue) => setValue(nextValue);
  const latest = useRef({ writeValue });
  latest.current = { writeValue };
  const activate = (event) => { event.preventDefault(); writeValue(!value); };
  useEffect(() => { setValue(seed); }, [seed]);
  return <button disabled onClick={activate}>{String(value)}</button>;
};`,
  },
  {
    name: "reports when a custom component owns the callback",
    reportsPropReseed: true,
    code: `import { useEffect, useRef, useState } from "react";
export const Panel = ({ seed }) => {
  const [value, setValue] = useState(seed);
  const writeValue = (nextValue) => setValue(nextValue);
  const latest = useRef({ writeValue });
  latest.current = { writeValue };
  const activate = (event) => { event.preventDefault(); writeValue(!value); };
  useEffect(() => { setValue(seed); }, [seed]);
  return <Control onClick={activate}>{String(value)}</Control>;
};`,
  },
  {
    name: "reports when a later spread can replace the native event",
    reportsPropReseed: true,
    code: `import { useEffect, useRef, useState } from "react";
export const Panel = ({ seed, extra }) => {
  const [value, setValue] = useState(seed);
  const writeValue = (nextValue) => setValue(nextValue);
  const latest = useRef({ writeValue });
  latest.current = { writeValue };
  const activate = (event) => { event.preventDefault(); writeValue(!value); };
  useEffect(() => { setValue(seed); }, [seed]);
  return <button onClick={activate} {...extra}>{String(value)}</button>;
};`,
  },
  {
    name: "reports when a dynamic function provider is visible",
    reportsPropReseed: true,
    code: `import { useEffect, useRef, useState } from "react";
export const Panel = ({ seed }) => {
  const [value, setValue] = useState(seed);
  Function("return 1");
  const writeValue = (nextValue) => setValue(nextValue);
  const latest = useRef({ writeValue });
  latest.current = { writeValue };
  const activate = (event) => { event.preventDefault(); writeValue(!value); };
  useEffect(() => { setValue(seed); }, [seed]);
  return <button onClick={activate}>{String(value)}</button>;
};`,
  },
  {
    name: "reports a context hook import shadowed by a component parameter",
    reportsPropReseed: true,
    code: `import { useContext, useEffect, useRef, useState } from "react";
import { DraftContext } from "./draft-context.js";
export const Panel = ({ seed, onValueChange, label, useContext }) => {
  const [value, setValue] = useState(seed);
  const parent = useContext(DraftContext);
  const controlled = seed !== undefined && onValueChange !== undefined;
  const displayedValue = controlled ? Boolean(seed) : parent ? parent.active : value;
  const writeValue = (nextValue) => {
    if (!controlled) {
      if (parent) parent.publish(nextValue);
      else setValue(nextValue);
    }
    onValueChange?.(nextValue);
  };
  const latest = useRef({ writeValue });
  latest.current = { writeValue };
  const activate = (event) => { event.preventDefault(); writeValue(!displayedValue); };
  useEffect(() => { setValue(seed); }, [seed]);
  return label && <button onClick={activate}>{String(displayedValue)}</button>;
};`,
  },
  {
    name: "reports when the host requires the controlled mode",
    reportsPropReseed: true,
    code: `import { useEffect, useRef, useState } from "react";
export const Panel = ({ seed, onValueChange }) => {
  const [value, setValue] = useState(seed);
  const controlled = seed !== undefined && onValueChange !== undefined;
  const displayedValue = controlled ? Boolean(seed) : value;
  const writeValue = (nextValue) => {
    if (!controlled) setValue(nextValue);
    onValueChange?.(nextValue);
  };
  const latest = useRef({ writeValue });
  latest.current = { writeValue };
  const activate = (event) => { event.preventDefault(); writeValue(!displayedValue); };
  useEffect(() => { setValue(seed); }, [seed]);
  return controlled && <button onClick={activate}>{String(displayedValue)}</button>;
};`,
  },
  {
    name: "reports when the host requires an existing context owner",
    reportsPropReseed: true,
    code: `import { useContext, useEffect, useRef, useState } from "react";
import { DraftContext } from "./draft-context.js";
export const Panel = ({ seed, onValueChange, label }) => {
  const [value, setValue] = useState(seed);
  const parent = useContext(DraftContext);
  const controlled = seed !== undefined && onValueChange !== undefined;
  const displayedValue = controlled ? Boolean(seed) : parent ? parent.active : value;
  const writeValue = (nextValue) => {
    if (!controlled) {
      if (parent) parent.publish(nextValue);
      else setValue(nextValue);
    }
    onValueChange?.(nextValue);
  };
  const latest = useRef({ writeValue });
  latest.current = { writeValue };
  const activate = (event) => { event.preventDefault(); writeValue(!displayedValue); };
  useEffect(() => { setValue(seed); }, [seed]);
  return parent && <button onClick={activate}>{String(displayedValue)}</button>;
};`,
  },
  {
    name: "reports when a prefix return hides the local fallback host",
    reportsPropReseed: true,
    code: `import { useContext, useEffect, useRef, useState } from "react";
import { DraftContext } from "./draft-context.js";
export const Panel = ({ seed, onValueChange, label }) => {
  const [value, setValue] = useState(seed);
  const parent = useContext(DraftContext);
  const controlled = seed !== undefined && onValueChange !== undefined;
  const displayedValue = controlled ? Boolean(seed) : parent ? parent.active : value;
  const writeValue = (nextValue) => {
    if (!controlled) {
      if (parent) parent.publish(nextValue);
      else setValue(nextValue);
    }
    onValueChange?.(nextValue);
  };
  const latest = useRef({ writeValue });
  latest.current = { writeValue };
  const activate = (event) => { event.preventDefault(); writeValue(!displayedValue); };
  useEffect(() => { setValue(seed); }, [seed]);
  if (!parent) return null;
  return label && <button onClick={activate}>{String(displayedValue)}</button>;
};`,
  },
  {
    name: "reports duplicate native event attributes",
    reportsPropReseed: true,
    code: `import { useEffect, useRef, useState } from "react";
export const Panel = ({ seed }) => {
  const [value, setValue] = useState(seed);
  const writeValue = (nextValue) => setValue(nextValue);
  const latest = useRef({ writeValue });
  latest.current = { writeValue };
  const activate = (event) => { event.preventDefault(); writeValue(!value); };
  useEffect(() => { setValue(seed); }, [seed]);
  return <button onClick={activate} onClick={() => {}}>{String(value)}</button>;
};`,
  },
  {
    name: "reports a native event below an inert ancestor",
    reportsPropReseed: true,
    code: `import { useEffect, useRef, useState } from "react";
export const Panel = ({ seed }) => {
  const [value, setValue] = useState(seed);
  const writeValue = (nextValue) => setValue(nextValue);
  const latest = useRef({ writeValue });
  latest.current = { writeValue };
  const activate = (event) => { event.preventDefault(); writeValue(!value); };
  useEffect(() => { setValue(seed); }, [seed]);
  return <section inert><button onClick={activate}>{String(value)}</button></section>;
};`,
  },
  {
    name: "reports an effectful default on the event handler",
    reportsPropReseed: true,
    code: `import { useEffect, useRef, useState } from "react";
export const Panel = ({ seed }) => {
  const [value, setValue] = useState(seed);
  const writeValue = (nextValue) => setValue(nextValue);
  const latest = useRef({ writeValue });
  latest.current = { writeValue };
  const activate = (event = (() => { throw new Error("blocked"); })()) => { event.preventDefault(); writeValue(!value); };
  useEffect(() => { setValue(seed); }, [seed]);
  return <button onClick={activate}>{String(value)}</button>;
};`,
  },
  {
    name: "reports a reassigned writer binding",
    reportsPropReseed: true,
    code: `import { useEffect, useRef, useState } from "react";
export const Panel = ({ seed }) => {
  const [value, setValue] = useState(seed);
  let writeValue = (nextValue) => setValue(nextValue);
  const latest = useRef({ writeValue });
  latest.current = { writeValue };
  writeValue = () => {};
  const activate = () => { writeValue(!value); };
  useEffect(() => { setValue(seed); }, [seed]);
  return <button onClick={activate}>{String(value)}</button>;
};`,
  },
  {
    name: "reports a selected writer shadowed by the event parameter",
    reportsPropReseed: true,
    code: `import { useEffect, useRef, useState } from "react";
export const Panel = ({ seed }) => {
  const [value, setValue] = useState(seed);
  const writeValue = (nextValue) => setValue(nextValue);
  const latest = useRef({ writeValue });
  latest.current = { writeValue };
  const activate = (writeValue) => { writeValue(!value); };
  useEffect(() => { setValue(seed); }, [seed]);
  return <button onClick={activate}>{String(value)}</button>;
};`,
  },
];

describe.each([
  { name: "direct", rule: noDerivedState },
  { name: "semantic wrapper", rule: wrapWithSemanticContext(noDerivedState) },
])("no-derived-state independent native event writers ($name)", ({ rule }) => {
  it.each(nativeEventWriterCases)("$name", (testCase) => {
    const result = runRule(rule, testCase.code, { forceJsx: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual(
      testCase.reportsPropReseed
        ? [
            {
              message:
                'Storing "value" in state when you can derive it from other values costs an extra render.',
              nodeType: "CallExpression",
            },
          ]
        : [],
    );
  });
});

it("retains the custom JSX runtime fence through the semantic wrapper", () => {
  const testCase = nativeEventWriterCases.find((candidate) => !candidate.reportsPropReseed);
  if (!testCase) throw new Error("Expected an independent native writer fixture");
  const result = runRule(
    wrapWithSemanticContext(noDerivedState),
    `/** @jsx customElement */\n${testCase.code}`,
    { forceJsx: true },
  );
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toEqual([
    {
      message:
        'Storing "value" in state when you can derive it from other values costs an extra render.',
      nodeType: "CallExpression",
    },
  ]);
});

describe("no-derived-state existing dynamic-scope behavior", () => {
  it("preserves the existing quiet direct-eval case independently of the native writer certificate", () => {
    const result = runRule(
      noDerivedState,
      `import { useEffect, useRef, useState } from "react";
export const Panel = ({ initial }) => {
  const [value, setValue] = useState(initial);
  const writeValue = (nextValue) => setValue(nextValue);
  eval("globalThis.React = null");
  const latest = useRef({ writeValue });
  latest.current = { writeValue };
  const activate = (event) => { event.preventDefault(); writeValue(!value); };
  useEffect(() => { setValue(initial); }, [initial]);
  return <a href="#" onClick={activate}>{String(value)}</a>;
};`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});

const correlatedNativeWriterCases = [
  {
    name: "opposite-alias-guard-facts",
    stateName: "expanded",
    code: `import { useEffect, useState } from "react";
export const Fold = ({ initial, blocked }) => {
  const [expanded, setExpanded] = useState(initial);
  const first = blocked;
  const second = !blocked;
  const write = (next) => { if (first) { if (second) setExpanded(next); } };
  const holder = { write };
  const activate = () => write(!expanded);
  useEffect(() => setExpanded(initial), [initial]);
  return <button onClick={activate}>{String(expanded)}</button>;
};`,
  },
  {
    name: "disjoint-comparison-guard-facts",
    stateName: "expanded",
    code: `import { useEffect, useState } from "react";
export const Fold = ({ initial, amount }) => {
  const [expanded, setExpanded] = useState(initial);
  const first = amount > 0;
  const second = amount < 0;
  const write = (next) => { if (first) { if (second) setExpanded(next); } };
  const holder = { write };
  const activate = () => write(!expanded);
  useEffect(() => setExpanded(initial), [initial]);
  return <button onClick={activate}>{String(expanded)}</button>;
};`,
  },
  {
    name: "host-gates-force-controlled-mode",
    stateName: "expanded",
    code: `import { useEffect, useState } from "react";
export const Fold = ({ initial, onChange }) => {
  const [expanded, setExpanded] = useState(initial);
  const controlled = initial !== undefined && onChange !== undefined;
  const write = (next) => { if (!controlled) setExpanded(next); };
  const holder = { write };
  const activate = () => write(!expanded);
  useEffect(() => setExpanded(initial), [initial]);
  return initial ? onChange ? <button onClick={activate}>{String(expanded)}</button> : null : null;
};`,
  },
  {
    name: "duplicate-controlled-input-prop-key-aliases-force-controlled-mode",
    stateName: "value",
    code: `import { useEffect, useRef, useState } from "react";
export const Panel = ({ initial: first, initial: second, onChange: callback, onChange: hostCallback }) => {
  const [value, setValue] = useState(first);
  const controlled = first !== undefined && callback !== undefined;
  const displayed = controlled ? Boolean(first) : value;
  const write = (next) => {
    if (!controlled) setValue(next);
    callback?.(next);
  };
  const latest = useRef({ write });
  latest.current = { write };
  const activate = () => write(!displayed);
  useEffect(() => { setValue(first); }, [first]);
  return second && hostCallback && <button onClick={activate}>{String(displayed)}</button>;
};`,
  },
];

describe("no-derived-state correlated native event boundaries", () => {
  it.each(correlatedNativeWriterCases)("$name", (testCase) => {
    const result = runRule(noDerivedState, testCase.code, { forceJsx: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([
      {
        message: `Storing "${testCase.stateName}" in state when you can derive it from other values costs an extra render.`,
        nodeType: "CallExpression",
      },
    ]);
  });
});

const nullContextHostBoundaryCases = [
  {
    name: "nested-context-assignment-target-removes-the-null-host-path",
    code: `import { useContext, useEffect, useRef, useState } from "react";
import { PanelContext } from "./panel-context.js";
export const Panel = ({ initial }) => {
  const [value, setValue] = useState(initial);
  const parent = useContext(PanelContext);
  const displayed = parent ? parent.active : value;
  const writeValue = (nextValue) => {
    if (parent) parent.publish(nextValue);
    else setValue(nextValue);
  };
  const latest = useRef({ writeValue });
  latest.current = { writeValue };
  ({ publish: parent.publish } = { publish: writeValue });
  const activate = () => writeValue(!displayed);
  useEffect(() => { setValue(initial); }, [initial]);
  return <button onClick={activate}>{String(displayed)}</button>;
};`,
  },
  {
    name: "unconditional-context-member-read-removes-the-null-host-path",
    code: `import { useContext, useEffect, useRef, useState } from "react";
import { PanelContext } from "./panel-context.js";
export const Panel = ({ initial }) => {
  const [value, setValue] = useState(initial);
  const parent = useContext(PanelContext);
  const displayed = parent ? parent.active : value;
  const writeValue = (nextValue) => {
    if (parent) parent.publish(nextValue);
    else setValue(nextValue);
  };
  const latest = useRef({ writeValue });
  latest.current = { writeValue };
  const previous = parent.publish;
  const activate = () => writeValue(!displayed);
  useEffect(() => { setValue(initial); }, [initial]);
  return <button onClick={activate}>{String(displayed)}</button>;
};`,
  },
];

describe("no-derived-state null context host reachability", () => {
  it.each(nullContextHostBoundaryCases)("$name", (testCase) => {
    const result = runRule(noDerivedState, testCase.code, { forceJsx: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([
      {
        message:
          'Storing "value" in state when you can derive it from other values costs an extra render.',
        nodeType: "CallExpression",
      },
    ]);
  });
});

describe("native event writer erased bindings and inert keys", () => {
  it.each([
    ["erased React hook", "interface useState {}\n"],
    ["inert JSX pragma string", "const description='@jsx factory';\n"],
    ["type-only hook exports", "export type {useState,useRef};\n"],
    ["inert object keys", "const notes={Function:'description',constructor:'description'};\n"],
    ["inert method keys", "class Notes { static Function(){return 'description'} }\n"],
  ])("preserves the editable state beside %s", (_name, prefix) => {
    const fixture = nativeEventWriterCases.find(
      (entry) => entry.name === "retains an odd own-state toggle through a ref-stored writer",
    );
    if (!fixture) throw Error("Expected the ordinary native writer fixture");
    const result = runRule(noDerivedState, prefix + fixture.code, { forceJsx: true });
    expect(result).toEqual({ diagnostics: [], parseErrors: [] });
  });
});

describe("native event writer renderer boundaries", () => {
  it.each(rendererFixtures.cases)("$name", ({ code, desired }) => {
    const result = runRule(noDerivedState, code, { forceJsx: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(desired);
    if (desired) expect(result.diagnostics[0].nodeType).toBe("CallExpression");
  });
});

describe.each([
  { name: "direct", rule: noDerivedStateEffect },
  { name: "semantic wrapper", rule: wrapWithSemanticContext(noDerivedStateEffect) },
])("companion effect native event witnesses ($name)", ({ rule }) => {
  it.each(nativeEventWriterCases)("$name", ({ code, reportsPropReseed }) => {
    const result = runRule(rule, code, { forceJsx: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(reportsPropReseed ? 1 : 0);
  });

  it.each(rendererFixtures.cases)("preserves renderer boundary $name", ({ code, desired }) => {
    const result = runRule(rule, code, { forceJsx: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(desired);
  });
});

describe.each([false, true])("mixed editable and derived state (copy first: %s)", (copyFirst) => {
  it.each([
    { name: "direct primary", rule: noDerivedState },
    { name: "wrapped primary", rule: wrapWithSemanticContext(noDerivedState) },
    { name: "direct companion", rule: noDerivedStateEffect },
    { name: "wrapped companion", rule: wrapWithSemanticContext(noDerivedStateEffect) },
  ])("retains the independent copy for $name", ({ rule }) => {
    const editableCopy = "setValue(seed);";
    const independentCopy = "setCaption(label);";
    const result = runRule(
      rule,
      `import { useEffect, useRef, useState } from "react";
export const Panel = ({ seed, label }) => {
  const [value, setValue] = useState(seed);
  const [caption, setCaption] = useState(label);
  const writeValue = (nextValue) => setValue(nextValue);
  const latest = useRef({ writeValue });
  latest.current = { writeValue };
  const activate = (event) => { event.preventDefault(); writeValue(!value); };
  useEffect(() => {
    ${copyFirst ? independentCopy : editableCopy}
    ${copyFirst ? editableCopy : independentCopy}
  }, [seed, label]);
  return <button onClick={activate}>{String(value)}{caption}</button>;
};`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    if (rule.id === noDerivedState.id) {
      expect(result.diagnostics[0]?.message).toContain('"caption"');
    }
  });
});
