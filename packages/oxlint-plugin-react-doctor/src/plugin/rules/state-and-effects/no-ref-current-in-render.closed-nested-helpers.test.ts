import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRefCurrentInRender } from "./no-ref-current-in-render.js";

describe("closed nested ref mutations in synchronous helpers", () => {
  it.each([
    ["{ count: 0 }", "count", "= value"],
    ["{ count: 0 }", "count", "++"],
    ["{ count: 2 }", "count", "--"],
    ["{ count: 2 }", "count", "+= 1"],
    ["{ count: 2 }", "count", "+= 1 + 1"],
    ["{ count: 2 }", "count", "+= -1"],
    ["{ count: 2 }", "count", "-= 1"],
    ["{ count: 2 }", "count", "*= 2"],
    ["{ count: 2 }", "count", "/= 2"],
    ["{ count: 2 }", "count", "%= 2"],
    ["{ count: 2 }", "count", "**= 2"],
    ["{ count: 2 }", "count", "|= 1"],
    ["[0]", "0", "= value"],
    ["[0]", "0", "++"],
    ["[2]", "0", "--"],
    ["[2]", "0", "+= 1"],
    ["[2]", "0", "+= 1 + 1"],
  ])("reports %s [%s] %s", (initializer, property, operation) => {
    const source = `import { useRef } from 'react';
export const Panel = ({ value }) => {
  const cache = useRef(${initializer});
  const write = () => { cache.current[${property === "0" ? property : JSON.stringify(property)}] ${operation}; };
  write();
  return null;
};`;
    const result = runRule(noRefCurrentInRender, source, { includeLocations: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.line)).toEqual([4]);
  });

  it.each([
    "const write = () => { cache.current.count = value; };",
    "const write = () => { cache.current.count = value; }; useEffect(write, []);",
    "const write = () => { cache.current.count = value; }; queueMicrotask(write);",
    "const write = () => { cache.current.count = value; }; expose(write); write();",
    "const write = (input = value) => { cache.current.count = input; }; write();",
    "const write = () => { cache.current.count += value; }; write();",
    "const write = () => { cache.current.count ||= 1; }; write();",
    "const write = () => { cache.current.count &&= 1; }; write();",
    "const write = () => { cache.current.count ??= 1; }; write();",
    "const write = () => { cache.current[value] = 1; }; write();",
    "const write = () => { return; cache.current.count = value; }; write();",
    "const payload = cache.current; const write = () => { cache.current.count = value; }; write();",
    "const write = () => { cache.current.count = value; }; const capability = other[0]; write();",
    "Object.defineProperty(cache, 'current', { get: () => null }); const write = () => { cache.current.count = value; }; write();",
  ])("declines uncertain ownership, payloads or coercion: %s", (body) => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useRef, useEffect } from 'react';
export const Panel = ({ value }) => {
  const cache = useRef({ count: 0 });
  ${body}
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["cache.current = null;", "cache.current.count = value;"],
    ["cache.current = value;", "cache.current.count = 1;"],
    ["const alias = cache; alias.current = null;", "cache.current.count = value;"],
  ])("retains only existing direct writes before an uncertain nested access", (prefix, write) => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useRef } from 'react';
export const Panel = ({ value }) => {
  const cache = useRef({ count: 0 });
  ${prefix}
  const write = () => { ${write} };
  write();
  return null;
};`,
      { includeLocations: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.line)).toEqual([4]);
  });

  it.each([
    "{ count: value }",
    "{ get count() { return 0; }, set count(next) {} }",
    "{ __proto__: { count: 0 } }",
    "Object.freeze({ count: 0 })",
  ])("declines an unproven numeric or writable payload: %s", (initializer) => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useRef } from 'react';
export const Panel = ({ value }) => {
  const cache = useRef(${initializer});
  const write = () => { cache.current.count++; };
  write();
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("retains a numeric field invariant across a preceding nested assignment", () => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useRef } from 'react';
export const Panel = () => {
  const cache = useRef({ count: 0 });
  const write = () => { cache.current.count = 2; cache.current.count++; };
  write();
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not infer numeric updates after an unknown value assignment", () => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useRef } from 'react';
export const Panel = ({ value }) => {
  const cache = useRef({ count: 0 });
  const write = () => { cache.current.count = value; cache.current.count++; };
  write();
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("preserves the original direct-helper route beside unrelated useRef properties", () => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useRef } from 'react';
const metadata = { useRef: 0 };
const read = () => metadata.useRef;
export const Panel = ({ value }) => {
  const cache = useRef(null);
  const write = () => { cache.current = value; };
  write();
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("supports a readonly numeric alias and an earlier certified compound expression", () => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useRef } from 'react';
export const Panel = () => {
  const cache = useRef({ count: 0, other: 0 });
  const amount = 1;
  const alias = amount;
  const write = () => { cache.current.count += 1 + 1; cache.current.other += alias; };
  write();
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it.each([
    "cache.current.count = read();",
    "cache.current.other = read(); cache.current.count++;",
    "cache.current.other += read(); cache.current.count++;",
    "cache.current.count += operand;",
  ])("keeps throwing or coercive RHS expressions outside the additional route: %s", (write) => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useRef } from 'react';
export const Panel = () => {
  const cache = useRef({ count: 0, other: 0 });
  const read = () => { throw new Error('rhs'); };
  const operand = { valueOf() { throw new Error('coercion'); } };
  const write = () => { ${write} };
  write();
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
