import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRefCurrentInRender } from "./no-ref-current-in-render.js";

describe("ref render writes across main integration", () => {
  it.each(["count", "current"])("reports every mixed write to %s once", (property) => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useRef } from "react";
const Panel = ({ value }) => {
  const valueRef = useRef(null);
  const cacheRef = useRef({ ${property}: 0 });
  Object.assign(valueRef, { current: value });
  cacheRef.current.${property} = value;
  cacheRef.current.${property}++;
  valueRef.current = value;
  return null;
};`,
      { includeLocations: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.line)).toEqual([5, 6, 7, 8]);
  });

  it("keeps direct Object.assign lazy initialization quiet alongside nested writes", () => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useRef } from "react";
const Panel = ({ value }) => {
  const valueRef = useRef(null);
  const cacheRef = useRef({ count: 0 });
  if (valueRef.current === null) {
    Object.assign(valueRef, { current: { count: 0 } });
  }
  cacheRef.current.count = value;
  cacheRef.current.count++;
  return null;
};`,
      { includeLocations: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.line)).toEqual([8, 9]);
  });

  it("retains unsafe direct initialization and both nested writes", () => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useRef } from "react";
const Panel = ({ value }) => {
  const valueRef = useRef(null);
  const cacheRef = useRef({ count: 0 });
  if (valueRef.current === null) {
    Object.assign(valueRef, { current: Math.random() });
  }
  cacheRef.current.count = value;
  cacheRef.current.count++;
  return null;
};`,
      { includeLocations: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.line)).toEqual([6, 8, 9]);
  });

  it("keeps all three write forms quiet in a deferred effect", () => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useEffect, useRef } from "react";
const Panel = ({ value }) => {
  const valueRef = useRef(null);
  const cacheRef = useRef({ count: 0 });
  useEffect(() => {
    Object.assign(valueRef, { current: value });
    cacheRef.current.count = value;
    cacheRef.current.count++;
  }, [value]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "const Object = { assign: (target, source) => target };",
    "Object.assign = (target, source) => target;",
  ])("retains nested writes when Object.assign is unproven: %s", (provider) => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useRef } from "react";
${provider}
const Panel = ({ value }) => {
  const valueRef = useRef(null);
  const cacheRef = useRef({ count: 0 });
  Object.assign(valueRef, { current: value });
  cacheRef.current.count = value;
  cacheRef.current.count++;
  return null;
};`,
      { includeLocations: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.line)).toEqual([7, 8]);
  });

  it.each([
    "const cacheRef = useRef({ get count() { return 0; }, set count(next) {} });",
    "const cacheRef = useRef({ __proto__: { count: 0 } });",
    "const cacheRef = useRef(createCache());",
    "let cacheRef = useRef({ count: 0 }); cacheRef = externalRef;",
  ])("keeps the direct route when a nested container is unproven: %s", (declaration) => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useRef } from "react";
const Panel = ({ value }) => {
  const valueRef = useRef(null);
  ${declaration}
  Object.assign(valueRef, { current: value });
  cacheRef.current.count = value;
  cacheRef.current.count++;
  return null;
};`,
      { includeLocations: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.line)).toEqual([5]);
  });
});
