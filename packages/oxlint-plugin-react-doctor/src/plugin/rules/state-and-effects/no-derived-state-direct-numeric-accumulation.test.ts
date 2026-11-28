import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDerivedStateEffect } from "./no-derived-state-effect.js";
import { noDerivedState } from "./no-derived-state.js";

const counter = `import { useEffect, useState } from "react";

export function TrainingCounter({ bonus }) {
  const [points, setPoints] = useState(0);
  useEffect(() => {
    const awarded = bonus ? 3 : 1;
    const next = points + awarded;
    setPoints(next);
  }, [bonus]);

  return <output>{points}</output>;
}`;

describe.each([
  ["no-derived-state", noDerivedState],
  ["no-derived-state-effect", noDerivedStateEffect],
] as const)("%s direct numeric accumulation", (_name, rule) => {
  it.each([
    ["local aliases", counter],
    ["an inline step", counter.replace("setPoints(next);", "setPoints(points + (bonus ? 3 : 1));")],
    ["subtraction", counter.replace("points + awarded", "points - awarded")],
    ["a commuted addition", counter.replace("points + awarded", "awarded + points")],
    [
      "a named hook alias",
      counter
        .replace("useEffect, useState", "useEffect as runEffect, useState")
        .replace("useEffect(()", "runEffect(()"),
    ],
  ])("keeps a numeric accumulator quiet with %s", (_case, code) => {
    const result = runRule(rule, code, { forceJsx: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [
      "an arithmetic read that discards the previous value",
      counter.replace("points + awarded", "(points * 0) + awarded"),
    ],
    ["ambient rounding", counter.replace("points + awarded", "Math.ceil(points + awarded)")],
    [
      "a shadowed state name",
      counter.replace("const next =", "const points = bonus ? 2 : 0; const next ="),
    ],
    [
      "a step with an unknown numeric domain",
      counter
        .replace("{ bonus }", "{ bonus, value }")
        .replace("bonus ? 3 : 1", "bonus ? value : 1"),
    ],
    ["a mixed numeric and string step", counter.replace("bonus ? 3 : 1", 'bonus ? "3" : 1')],
    [
      "a mutable result alias",
      counter
        .replace("const next =", "let next =")
        .replace("setPoints(next);", "next = awarded; setPoints(next);"),
    ],
    [
      "a step that cannot change the initialized value",
      counter.replace("useState(0)", "useState(1e100)"),
    ],
    ["two zero steps", counter.replace("bonus ? 3 : 1", "bonus ? 0 : 0")],
    [
      "mount-only dependencies",
      counter.replace("bonus ? 3 : 1", "bonus ? 1 : 1").replace("[bonus]", "[]"),
    ],
    [
      "an invariant dependency",
      counter.replace("bonus ? 3 : 1", "bonus ? 1 : 1").replace("[bonus]", "[false]"),
    ],
    [
      "an aliased empty dependency array",
      counter
        .replace("useEffect(()", "const once = []; useEffect(()")
        .replace("bonus ? 3 : 1", "bonus ? 1 : 1")
        .replace("[bonus]", "once"),
    ],
    [
      "a state read outside the return",
      counter.replace("return <output>{points}</output>;", "void points; return null;"),
    ],
    [
      "a detached JSX state read",
      counter.replace(
        "return <output>{points}</output>;",
        "const detached = <output>{points}</output>; return null;",
      ),
    ],
    [
      "an unreachable state write",
      counter.replace("setPoints(next);", "if (true) return; setPoints(next);"),
    ],
    [
      "an unreachable JSX state read",
      counter.replace("return <output>", "if (true) return null; return <output>"),
    ],
    [
      "a JSX attribute on an opaque component",
      counter.replace("return <output>{points}</output>;", "return <Output value={points} />;"),
    ],
    [
      "an opaque component that discards its children",
      counter.replace("return <output>{points}</output>;", "return <Ignore>{points}</Ignore>;") +
        "\nfunction Ignore() { return null; }",
    ],
    ["hidden markup", counter.replace("<output>", "<output hidden>")],
    ["an inert template", counter.replaceAll("output", "template")],
    ["an unknown dependency expression", counter.replace("[bonus]", "[bonus, fail()]")],
    ["a spread dependency", counter.replace("[bonus]", "[bonus, ...undefined]")],
    [
      "a replacement of the default React state hook",
      counter.replace(
        'import { useEffect, useState } from "react";',
        'import React, { useEffect, useState } from "react"; React.useState = () => [0, () => {}];',
      ),
    ],
    [
      "a replacement through a namespace alias",
      counter.replace(
        'import { useEffect, useState } from "react";',
        'import * as React from "react"; import { useEffect, useState } from "react"; const Runtime = React; Object.assign(Runtime, { useEffect: () => {} });',
      ),
    ],
    [
      "a replacement through a CommonJS import",
      counter.replace(
        'import { useEffect, useState } from "react";',
        'import { useEffect, useState } from "react"; require("react").useEffect = () => {};',
      ),
    ],
    [
      "a replacement through a loader alias",
      counter.replace(
        'import { useEffect, useState } from "react";',
        'import { useEffect, useState } from "react"; const load = require; const Runtime = load("react"); Runtime.useState = () => [0, () => {}];',
      ),
    ],
    ["a non-finite state seed", counter.replace("useState(0)", "useState(1e309)")],
    [
      "an independent reset in the effect",
      counter.replace("setPoints(next);", "setPoints(awarded); setPoints(next);"),
    ],
  ])("retains the warning for %s", (_case, code) => {
    const result = runRule(rule, code, { forceJsx: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
