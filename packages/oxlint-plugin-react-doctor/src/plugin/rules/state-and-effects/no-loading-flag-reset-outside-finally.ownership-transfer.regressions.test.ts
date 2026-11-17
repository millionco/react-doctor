import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noLoadingFlagResetOutsideFinally } from "./no-loading-flag-reset-outside-finally.js";

describe("loading ownership transfer discharge", () => {
  it.each(["local", "parameter", "destructured"])(
    "requires an initialized numeric variable rather than a fallback: %s",
    (bindingKind) => {
      const result = runRule(
        noLoadingFlagResetOutsideFinally,
        `import { useRef, useState } from "react";
         const Panel = ({ request, input }) => {
           const generation = useRef(0);
           const [, setLoading] = useState(false);
           ${bindingKind === "destructured" ? "const { count = 0 } = input;" : ""}
           const first = async () => {
             const ticket = ++generation.current;
             setLoading(true);
             try { await request(); }
             finally { if (generation.current === ticket) setLoading(false); }
           };
           const second = async (${bindingKind === "parameter" ? "count = 0" : ""}) => {
             ${bindingKind === "local" ? "let count = 0;" : ""}
             const ticket = ++generation.current;
             setLoading(true);
             try { await request(); }
             finally { const next = count + 1; if (generation.current === ticket) setLoading(false); }
           };
           return { first, second };
         };`,
      );
      expect(result.parseErrors).toEqual([]);
      if (bindingKind === "local") expect(result.diagnostics).toEqual([]);
      else expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
    },
  );

  it.each([
    ["", 0],
    ["unused", 0],
    ["...unused", 0],
    ["unused = 0", 0],
    ["unused = fail()", 1],
    ["{ unused }", 1],
    ["[unused]", 1],
  ])("checks called successor parameter initialization: %s", (parameters, expectedCount) => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useEffect, useRef, useState } from "react";
       const Panel = ({ request, fail }) => {
         const generation = useRef(0);
         const [, setLoading] = useState(false);
         const run = async (${parameters}) => {
           const ticket = ++generation.current;
           setLoading(true);
           try { await request(); }
           finally { if (generation.current === ticket) setLoading(false); }
         };
         useEffect(() => { generation.current++; setLoading(true); run(); }, []);
         return run;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });

  it.each([
    ["source.value;", 1],
    ["const value = source.value;", 1],
    ["const value = null; value.missing;", 1],
    ["const { value } = source;", 1],
    ["const value = { ...source };", 1],
    ["const value = [...source];", 1],
    ["for (const value of source) {}", 1],
    ["const value = +coercible;", 1],
    ["const value = `${coercible}`;", 1],
    ["const value = coercible + 1;", 1],
    ["const value = later; const later = 0;", 1],
    ["class Value extends 0 {}", 1],
    ["const current = generation.current;", 0],
    ["const value = {};", 0],
    ["Math.round(0);", 0],
    ["", 0],
  ])("checks throwing successor finalizer expressions: %s", (prefix, expectedCount) => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useRef, useState } from "react";
       const Panel = ({ request }) => {
         const generation = useRef(0);
         const [, setLoading] = useState(false);
         const source = { get value() { throw new Error(); } };
         const coercible = { [Symbol.toPrimitive]() { throw new Error(); } };
         const first = async () => {
           const ticket = ++generation.current;
           setLoading(true);
           try { await request(); }
           finally { if (generation.current === ticket) setLoading(false); }
         };
         const second = async () => {
           const ticket = ++generation.current;
           setLoading(true);
           try { await request(); }
           finally { ${prefix} if (generation.current === ticket) setLoading(false); }
         };
         return { first, second };
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    if (expectedCount === 0) expect(result.diagnostics).toHaveLength(0);
    else expect(result.diagnostics.length).toBeGreaterThanOrEqual(expectedCount);
  });

  it("does not certify a conditional claim in a called successor", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useEffect, useRef, useState } from "react";
       const Panel = ({ request, enabled }) => {
         const generation = useRef(0);
         const [, setLoading] = useState(false);
         const run = async () => {
           let ticket;
           if (enabled) ticket = ++generation.current;
           setLoading(true);
           try { await request(); }
           finally { if (generation.current === ticket) setLoading(false); }
         };
         useEffect(() => { generation.current++; setLoading(true); run(); }, []);
         return run;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
  });

  it.each([
    ["generation.current++;", "0", "const run = async () =>", 0],
    ["generation.current = coercible;", "0", "const run = async () =>", 1],
    [
      "({ value: generation.current } = { value: coercible }); generation.current++;",
      "0",
      "const run = async () =>",
      1,
    ],
    [
      "for (generation.current of [coercible]) {} generation.current++;",
      "0",
      "const run = async () =>",
      1,
    ],
    [
      "delete (generation.current as any); generation.current++;",
      "0",
      "const run = async () =>",
      1,
    ],
    ["generation.current++;", "coercible", "const run = async () =>", 1],
    ["escape(generation); generation.current++;", "0", "const run = async () =>", 1],
    ["generation.current++;", "0", "async function* run()", 1],
  ])(
    "requires an immediate numeric successor: %s %s %s",
    (invalidation, initialValue, declaration, expectedCount) => {
      const result = runRule(
        noLoadingFlagResetOutsideFinally,
        `import { useEffect, useRef, useState } from "react";
       const Panel = ({ request, escape }) => {
         const coercible = { [Symbol.toPrimitive]() { throw new Error(); } };
         const generation = useRef(${initialValue});
         const [, setLoading] = useState(false);
         ${declaration} {
           const ticket = ++generation.current;
           setLoading(true);
           try { await request(); }
           finally { if (generation.current === ticket) setLoading(false); }
         };
         useEffect(() => { ${invalidation} setLoading(true); run(); }, []);
         return run;
       };`,
      );
      expect(result.parseErrors).toEqual([]);
      if (expectedCount === 0) expect(result.diagnostics).toHaveLength(0);
      else expect(result.diagnostics.length).toBeGreaterThanOrEqual(expectedCount);
    },
  );

  it.each([
    ["setLoading(true);", 1],
    ["setLoading(false); setLoading(true);", 1],
    ["setOtherLoading(false);", 1],
    ["setLoading(false);", 0],
    ["if (enabled) setLoading(false);", 1],
    ["setLoading(true); throw new Error();", 1],
    [
      "setLoading(true); beforeRequest(); try { await request(); } finally { setLoading(false); }",
      1,
    ],
    ["setLoading(true); if (cancelled) return;", 1],
    ["setLoading(enabled);", 1],
    [
      "setLoading(true); if (cancelled) return; try { await request(); } finally { setLoading(false); }",
      1,
    ],
    ["setLoading(true); await request(); setLoading(false);", 1],
    ["setLoading(true); try { await request(); } finally { setLoading(false); }", 0],
    [
      "setLoading(true); try { await request(); } finally { if (generation.current === ticket) setLoading(false); }",
      0,
    ],
    [
      "setLoading(true); try { await request(); } finally { if (generation.current !== ticket) return; setLoading(false); }",
      0,
    ],
    [
      "setLoading(true); try { await request(); } finally { const isCurrent = () => generation.current === ticket; if (isCurrent()) setLoading(false); }",
      0,
    ],
    ["setLoading(true); try { await request(); } finally { beforeReset(); setLoading(false); }", 1],
    [
      "setLoading(true); try { await request(); } finally { return; if (generation.current === ticket) setLoading(false); }",
      1,
    ],
    [
      "setLoading(true); try { await request(); } finally { if (generation.current === ticket && enabled) setLoading(false); }",
      1,
    ],
    [
      "setLoading(true); try { await request(); } finally { setLoading(false); setLoading(true); }",
      1,
    ],
    [
      "setLoading(true); try { await request(); } finally { discharge: { if (!enabled) break discharge; if (generation.current === ticket) setLoading(false); } }",
      1,
    ],
    [
      "setLoading(true); try { await request(); } finally { inner: { if (!enabled) break inner; } if (generation.current === ticket) setLoading(false); }",
      0,
    ],
    [
      "setLoading(true); try { await request(); } finally { for (let index = 0; index < 1; index++) { continue; } if (generation.current === ticket) setLoading(false); }",
      0,
    ],
    [
      "setLoading(true); inner: { if (!enabled) break inner; } try { await request(); } finally { if (generation.current === ticket) setLoading(false); }",
      0,
    ],
    [
      "setLoading(true); try { await request(); } finally { switch (enabled) { case false: break; default: break; } if (generation.current === ticket) setLoading(false); }",
      0,
    ],
    [
      "setLoading(true); try { await request(); } finally { outer: inner: for (let index = 0; index < 1; index++) { continue outer; } if (generation.current === ticket) setLoading(false); }",
      0,
    ],
  ])("requires the successor to discharge loading: %s", (replacement, expectedCount) => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useRef, useState } from "react";
       const Panel = ({ request, enabled, cancelled }) => {
         const generation = useRef(0);
         const [, setLoading] = useState(false);
         const [, setOtherLoading] = useState(false);
         const run = async () => {
           const ticket = ++generation.current;
           setLoading(true);
           try { await request(); }
           finally { if (generation.current === ticket) setLoading(false); }
         };
         const replace = async () => {
           const ticket = ++generation.current;
           ${replacement}
         };
         return { run, replace };
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(expectedCount);
    if (expectedCount === 0) expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    ["setLoading(false);", 0],
    ["setLoading(true);", 1],
    ["setLoading(false); setLoading(true);", 1],
    ["setLoading(true); run();", 0],
  ])("does not let an effect bypass successor discharge: %s", (replacement, expectedCount) => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useEffect, useRef, useState } from "react";
       const Panel = ({ request }) => {
         const generation = useRef(0);
         const [, setLoading] = useState(false);
         const run = async () => {
           const ticket = ++generation.current;
           setLoading(true);
           try { await request(); }
           finally { if (generation.current === ticket) setLoading(false); }
         };
         useEffect(() => { generation.current++; ${replacement} }, []);
         return run;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });

  it("keeps transfer certificates isolated by setter", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useRef, useState } from "react";
       const Panel = ({ request }) => {
         const generation = useRef(0);
         const [, setLoading] = useState(false);
         const [, setBusy] = useState(false);
         const run = async () => {
           const ticket = ++generation.current;
           setLoading(true);
           setBusy(true);
           try { await request(); }
           finally {
             if (generation.current === ticket) { setLoading(false); setBusy(false); }
           }
         };
         const replace = async () => {
           const ticket = ++generation.current;
           setLoading(true);
           try { await request(); }
           finally { if (generation.current === ticket) setLoading(false); }
           setBusy(true);
         };
         return { run, replace };
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([false, true])("preserves transfers to another protected loader: %s", (reverseOrder) => {
    const loaderNames = reverseOrder ? ["loadSecond", "loadFirst"] : ["loadFirst", "loadSecond"];
    const loaders = loaderNames
      .map(
        (loaderName) => `const ${loaderName} = async () => {
      const ticket = ++generation.current;
      setLoading(true);
      try { await request(); }
      finally { if (generation.current === ticket) setLoading(false); }
    };`,
      )
      .join("\n");
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useEffect, useRef, useState } from "react";
       const Panel = ({ request }) => {
         const generation = useRef(0);
         const [, setLoading] = useState(false);
         ${loaders}
         useEffect(() => { generation.current++; setLoading(true); loadFirst(); }, []);
         return { loadFirst, loadSecond };
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not let a lexical catch absorb a called successor's setup failure", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useEffect, useRef, useState } from "react";
       const Panel = ({ request }) => {
         const generation = useRef(0);
         const [, setLoading] = useState(false);
         try {
           const run = async () => {
             const ticket = ++generation.current;
             setLoading(true);
             throw new Error();
             try { await request(); }
             finally { if (generation.current === ticket) setLoading(false); }
           };
           useEffect(() => { generation.current++; setLoading(true); run(); }, []);
           return run;
         } catch {}
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["const isStale = () => generation.current !== ticket; if (!isStale()) setLoading(false);", 0],
    [
      "const isCurrent = () => generation.current === ticket; if (!isCurrent()) return; setLoading(false);",
      0,
    ],
    ["if (!!(generation.current === ticket)) setLoading(false);", 0],
    [
      "const isStale = () => generation.current !== ticket || generation.current !== ticket; if (!isStale()) setLoading(false);",
      0,
    ],
    ["if (mounted.current && generation.current === ticket) setLoading(false);", 0],
    ["if (!mounted.current || generation.current !== ticket) return; setLoading(false);", 0],
    ["if (view.current === viewId && generation.current === ticket) setLoading(false);", 0],
    ["if (enabled && generation.current === ticket) setLoading(false);", 1],
    ["const isCurrent = () => !isCurrent(); if (isCurrent()) setLoading(false);", 1],
    [
      "const isCurrent = () => !isStale(); const isStale = () => !isCurrent(); if (!isCurrent()) return; setLoading(false);",
      1,
    ],
  ])("preserves certified successor guard forms: %s", (finalizer, expectedCount) => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useEffect, useRef, useState } from "react";
       const Panel = ({ request, viewId, enabled }) => {
         const generation = useRef(0);
         const mounted = useRef(true);
         const view = useRef(viewId);
         const [, setLoading] = useState(false);
         useEffect(() => () => { mounted.current = false; }, []);
         useEffect(() => { view.current = viewId; setLoading(false); }, [viewId]);
         const first = async () => {
           const ticket = ++generation.current;
           setLoading(true);
           try { await request(); }
           finally { if (generation.current === ticket) setLoading(false); }
         };
         const second = async () => {
           const ticket = ++generation.current;
           setLoading(true);
           try { await request(); }
           finally { ${finalizer} }
         };
         return { first, second };
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    if (expectedCount === 0) expect(result.diagnostics).toHaveLength(0);
    else expect(result.diagnostics.length).toBeGreaterThanOrEqual(expectedCount);
  });
});
