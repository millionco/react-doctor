import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { debounceNoCleanup } from "./debounce-no-cleanup.js";

const LODASH_DEBOUNCE_IMPORT = `import { debounce, throttle } from 'lodash';\n`;

describe("debounce-no-cleanup", () => {
  it("flags a useMemo debounce doing async work, driven from an effect, with no cancel cleanup", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function Search() {
        const search = useMemo(() => debounce(async (value) => {
          const results = await fetchResults(value);
          setResults(results);
        }, 500), []);
        useEffect(() => {
          search(query);
        }, [query, search]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    "; scheduled(query);",
    "void 0; scheduled(query);",
    "; (scheduled).cancel(); scheduled(query);",
    "; (scheduled as any).cancel(); scheduled(query);",
    "; scheduled!.cancel(); scheduled(query);",
  ])("keeps pending invocations visible through inert setup statements: %s", (setup) => {
    const result = runRule(
      debounceNoCleanup,
      `import { useEffect, useMemo } from 'react';
      import { debounce } from 'es-toolkit/compat';
      function Search({ query }) {
        const scheduled = useMemo(() => debounce(async value => { await load(value); }, 250), []);
        useEffect(() => { ${setup} }, [query, scheduled]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([";", "void 0;", "; void 0;"])("ignores inert memo factory prologues: %s", (prologue) => {
    const result = runRule(
      debounceNoCleanup,
      `import { useEffect, useMemo } from 'react';
      import { debounce } from 'es-toolkit/compat';
      function Search({ query }) {
        const scheduled = useMemo(() => { ${prologue} return debounce(async value => { void 0; await load(value); }, 250); ${prologue} }, []);
        useEffect(() => { void 0; scheduled(query); }, [query, scheduled]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    "return scheduled(query);",
    "void 0; return scheduled(query);",
    "; return scheduled(query);",
    "return (scheduled(query));",
  ])("recognizes returned known cleanup calls that rearm after release: %s", (cleanup) => {
    const result = runRule(
      debounceNoCleanup,
      `import { useEffect, useMemo } from 'react';
      import { debounce } from 'es-toolkit/compat';
      function Search({ query }) {
        const scheduled = useMemo(() => debounce(async value => { await load(value); }, 250), []);
        useEffect(() => { scheduled(query); return () => scheduled.cancel(); }, [query, scheduled]);
        useEffect(() => { void 0; return () => { ${cleanup} }; ; }, [query, scheduled]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    "; (scheduled).cancel();",
    "void 0; return scheduled.cancel();",
    "void 0; return stop();",
  ])("retains proven releases through inert cleanup statements: %s", (cleanup) => {
    const result = runRule(
      debounceNoCleanup,
      `import { useEffect, useMemo } from 'react';
      import { debounce } from 'es-toolkit/compat';
      function Search({ query }) {
        const scheduled = useMemo(() => debounce(async value => { await load(value); }, 250), []);
        const stop = scheduled.cancel;
        useEffect(() => { scheduled(query); return () => { ${cleanup} }; }, [query, scheduled]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("retains a directly returned release alias after inert effect statements", () => {
    const result = runRule(
      debounceNoCleanup,
      `import { useEffect, useMemo } from 'react';
      import { debounce } from 'es-toolkit/compat';
      function Search({ query }) {
        const scheduled = useMemo(() => debounce(async value => { await load(value); }, 250), []);
        const stop = scheduled.cancel;
        useEffect(() => { ; scheduled(query); void 0; return stop; ; }, [query, scheduled]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    "return releaseUnknown();",
    "void 0; return releaseUnknown();",
    "void scheduled.cancel();",
    "void 0; void scheduled.cancel();",
  ])("keeps opaque returned calls and effectful void expressions unsupported: %s", (cleanup) => {
    const result = runRule(
      debounceNoCleanup,
      `import { useEffect, useMemo } from 'react';
      import { debounce } from 'es-toolkit/compat';
      import { releaseUnknown } from './synthetic-owner';
      function Search({ query }) {
        const scheduled = useMemo(() => debounce(async value => { await load(value); }, 250), []);
        useEffect(() => { scheduled(query); return () => { ${cleanup} }; }, [query, scheduled]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each(["void releaseUnknown();", "void 0; void releaseUnknown();", "undefined;"])(
    "declines unmodeled factory prologues rather than treating them as inert: %s",
    (prologue) => {
      const result = runRule(
        debounceNoCleanup,
        `import { useEffect, useMemo } from 'react';
        import { debounce } from 'es-toolkit/compat';
        import { releaseUnknown } from './synthetic-owner';
        function Search({ query }) {
          const undefined = releaseUnknown;
          const scheduled = useMemo(() => { ${prologue} return debounce(async value => { await load(value); }, 250); }, []);
          useEffect(() => { scheduled(query); }, [query, scheduled]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    },
  );

  it.each([
    ["", "return () => {};", 1],
    ["", "return () => { if (enabled) stop(); };", 1],
    ["", "return () => { if (enabled) stop(); else search.cancel(); };", 0],
    ["", "return () => externalCleanup();", 0],
    ["globalThis.finish = () => stop();", "", 0],
    ["const finishLocal = () => stop(); globalThis.finish = finishLocal;", "", 0],
    [
      "const inner = () => stop(); const finishLocal = () => inner(); globalThis.finish = finishLocal;",
      "",
      0,
    ],
    ["const truthy = () => {};", "return () => { if (truthy) stop(); };", 0],
    ["const truthy = {};", "return () => { if (truthy) stop(); };", 0],
    ["const truthy = [];", "return () => { if (truthy) stop(); };", 0],
    ["globalThis.finish = () => stop();", "return () => finish();", 0],
    [
      "const finishLocal = () => stop(); globalThis.finish = finishLocal;",
      "return () => finish();",
      0,
    ],
    ["const guard = () => true;", "return () => { if (guard()) stop(); };", 0],
    [
      "const truthy = () => {}; const guard = () => truthy;",
      "return () => { if (guard()) stop(); };",
      0,
    ],
    ["const helper = () => stop();", "return () => toggle(helper());", 0],
    ["const helper = () => stop();", "return () => toggle(helper);", 0],
    ["const helper = () => stop();", "return () => { if (next(helper())) stop(); };", 0],
    ["const guard = async () => { return true; };", "return () => { if (guard()) stop(); };", 0],
    ["function* guard() { return true; }", "return () => { if (guard()) stop(); };", 0],
    ["", `return () => eval("stop()");`, 0],
    ["", `return () => { if (eval("stop(); false")) stop(); };`, 0],
    ["const finish = () => stop();", "return () => finish();", 0],
    ["const inner = () => stop(); const finish = () => inner();", "return () => finish();", 0],
    ["const finish = () => stop();", "finish(); return () => {};", 0],
    [
      "const inner = () => { stop(); return false; }; const guard = () => inner();",
      "return () => { if (guard()) stop(); };",
      0,
    ],
    ["const finish = enabled ? stop : externalCleanup;", "return () => finish();", 0],
    [
      "let state = false; const next = () => { state = !state; return state; };",
      "return () => { if (next()) stop(); };",
      0,
    ],
    [
      "const guard = enabled ? () => true : externalCleanup;",
      "return () => { if (guard()) stop(); };",
      0,
    ],
  ])(
    "separates recognized finite cleanup from opaque ownership: %s %s",
    (declarations, cleanup, expected) => {
      const result = runRule(
        debounceNoCleanup,
        `import { useEffect, useMemo } from 'react';
      import { debounce } from 'es-toolkit/compat';
      import { externalCleanup } from './external-cleanup';
      function Search({ query, enabled }) {
        const search = useMemo(() => debounce(async value => { await load(value); }, 500), []);
        const stop = search.cancel;
        ${declarations}
        useEffect(() => { search(query); ${cleanup} }, [search]);
        return null;
      }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(expected);
    },
  );

  it.each([
    ["import { debounce } from 'es-toolkit/compat';", "debounce"],
    ["import { debounce as postpone } from 'es-toolkit/compat';", "postpone"],
  ])("reports effect-driven named compat debounce: %s", (imports, factory) => {
    const result = runRule(
      debounceNoCleanup,
      `${imports}
      function Search({ query }) {
        const search = useMemo(() => ${factory}(async (value) => {
          await fetchResults(value);
        }, 500), []);
        useEffect(() => { search(query); }, [query, search]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    "useEffect(() => { search(query); return () => search.cancel(); }, [query, search]); return null;",
    "return <input onChange={() => search(query)} />;",
  ])("keeps cancelled and event-only compat debounce quiet: %s", (usage) => {
    const result = runRule(
      debounceNoCleanup,
      `import { debounce as postpone } from 'es-toolkit/compat';
      function Search({ query }) {
        const search = useMemo(() => { return postpone(async (value) => {
          await fetchResults(value);
        }, 500); }, []);
        ${usage}
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [
      "unsupported other-instance member call",
      `import { debounce } from 'es-toolkit/compat';
      function Search({ query }) {
        const search = useMemo(() => debounce(async (value) => { await fetchResults(value); }, 500), []);
        const unrelated = debounce(() => {}, 500);
        const stop = () => search.cancel();
        useEffect(() => { search(query); unrelated.cancel(); }, [query, search]);
        return null;
      }`,
    ],
    [
      "unsupported detached other-instance call",
      `import { debounce } from 'es-toolkit/compat';
      function Search({ query }) {
        const search = useMemo(() => debounce(async (value) => { await load(value); }, 500), []);
        const other = debounce(() => {}, 500);
        const stop = other.cancel;
        useEffect(() => { search(query); stop(); }, [query, search]);
        return null;
      }`,
    ],
  ])(
    "declines other-instance calls outside the finite cleanup contract: %s",
    (_caseName, source) => {
      const result = runRule(debounceNoCleanup, source);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    },
  );

  it("declines an unused release-capturing helper outside the finite ownership contract", () => {
    const result = runRule(
      debounceNoCleanup,
      `import { debounce } from 'es-toolkit/compat';
      function Search({ query }) {
        const search = useMemo(() => debounce(async (value) => { await fetchResults(value); }, 500), []);
        const unrelated = debounce(() => {}, 500);
        const stop = () => search.cancel();
        useEffect(() => { search.cancel(); search(query); }, [query, search]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    ["search.cancel();", 0],
    ["search.flush();", 0],
    ["search.bind(null, query);", 0],
    ["search(query); search.cancel();", 0],
    ["search(query); search.flush();", 0],
    ["const alias = search; search(query); alias.cancel();", 0],
    ["search(query); stop();", 0],
    ["search.cancel(); search(query);", 1],
    ["search(query); search.cancel(); search(query);", 1],
    ["const alias = search; alias(query);", 1],
  ])(
    "checks directly owned compat scheduling without an unused captured helper: %s",
    (setup, expected) => {
      const result = runRule(
        debounceNoCleanup,
        `import { debounce } from 'es-toolkit/compat';
      function Search({ query }) {
        const search = useMemo(() => debounce(async (value) => { await fetchResults(value); }, 500), []);
        const unrelated = debounce(() => {}, 500);
        ${setup.includes("stop()") ? "const stop = () => search.cancel();" : ""}
        useEffect(() => { ${setup} }, [query, search]);
        return null;
      }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(expected);
    },
  );

  it.each([
    [
      "const read = (value) => value;",
      "const read = async (value) => { await load(value); };",
      "",
      0,
    ],
    [
      "const read = async (value) => { await load(value); };",
      "const read = (value) => value;",
      "",
      1,
    ],
    ["const read = async (value) => { await load(value); };", "", "search = () => {};", 0],
  ])(
    "uses the lexical compat callback and closed wrapper: %s",
    (resolved, shadow, reassign, expected) => {
      const result = runRule(
        debounceNoCleanup,
        `import { debounce } from 'es-toolkit/compat';
      function Search({ query }) {
        function nested() { ${shadow} }
        ${resolved}
        ${reassign ? "let" : "const"} search = useMemo(() => debounce(read, 500), []);
        ${reassign}
        useEffect(() => { search(query); }, [query, search]);
        return null;
      }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(expected);
    },
  );

  it.each([
    ["import { throttle as debounce } from 'es-toolkit/compat';", "debounce"],
    ["import { debounce } from 'es-toolkit';", "debounce"],
    ["import { debounce } from './debounce';", "debounce"],
    ["import debounce from 'es-toolkit/compat';", "debounce"],
    ["import * as compat from 'es-toolkit/compat';", "compat.debounce"],
    ["import { type debounce } from 'es-toolkit/compat';", "debounce"],
    ["import type { debounce } from 'es-toolkit/compat';", "debounce"],
  ])("ignores unproven debounce imports: %s", (imports, factory) => {
    const result = runRule(
      debounceNoCleanup,
      `${imports}
      function Search({ query }) {
        const search = useMemo(() => ${factory}(async (value) => {
          await fetchResults(value);
        }, 500), []);
        useEffect(() => { search(query); }, [query, search]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "const search = useMemo(() => debounce(async () => { await load(); }, 500, options), []);",
    "const search = useMemo(() => debounce(async () => { await load(); }, delay), []);",
    "const search = useMemo(async () => debounce(async () => { await load(); }, 500), []);",
    "const search = useCallback(() => debounce(async () => { await load(); }, 500), []);",
    "const search = useMemo(debounce(async () => { await load(); }, 500), []);",
    "const search = useMemo((debounce) => debounce(async () => { await load(); }, 500), []);",
  ])(
    "does not infer a compat lifetime for opaque or different factory shapes: %s",
    (initializer) => {
      const result = runRule(
        debounceNoCleanup,
        `import { debounce } from 'es-toolkit/compat';
      function Search({ query, delay, options }) {
        ${initializer}
        useEffect(() => { search(query); }, [query, search]);
        return null;
      }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it.each([
    ["const stop = search.cancel;", "search(query); stop();", 0],
    ["const { cancel: stop } = search;", "search(query); stop();", 0],
    ["const flush = search.flush; const finish = flush;", "search(query); finish();", 0],
    ["const stop = search.cancel;", "search(query); return stop;", 0],
    ["const stop = search.cancel;", "search(query); return () => stop();", 0],
    ["const stop = search.cancel;", "search(query); stop(); search(query);", 1],
  ])("resolves a detached compat release on the exact instance: %s", (alias, setup, expected) => {
    const result = runRule(
      debounceNoCleanup,
      `import { debounce } from 'es-toolkit/compat';
      function Search({ query }) {
        const search = useMemo(() => debounce(async (value) => { await load(value); }, 500), []);
        const other = debounce(() => {}, 500);
        ${alias}
        useEffect(() => { ${setup} }, [query, search]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });

  it.each([
    ["useEffect(() => { search(query); }, []); useEffect(() => { search.cancel(); }, []);", 0],
    ["useEffect(() => { search.cancel(); }, []); useEffect(() => { search(query); }, []);", 1],
    ["useEffect(() => { search(query); }, [query]); useEffect(() => { search.cancel(); }, []);", 1],
    [
      "useEffect(() => { search(query); }, []); useLayoutEffect(() => { search.cancel(); }, []);",
      1,
    ],
    [
      "useEffect(() => { search(query); }, []); useEffect(() => { search.cancel(); search(query); }, []);",
      1,
    ],
  ])("only transfers release to the following passive mount effect: %s", (effects, expected) => {
    const result = runRule(
      debounceNoCleanup,
      `import { useEffect, useLayoutEffect, useMemo } from 'react';
      import { debounce } from 'es-toolkit/compat';
      function Search({ query }) {
        const search = useMemo(() => debounce(async (value) => { await load(value); }, 500), []);
        ${effects}
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });

  it.each([
    [
      "const stop = search.cancel; useEffect(() => { search(query); }, [query, search]); useEffect(() => () => stop(), [search]);",
      0,
    ],
    [
      "const stop = search.cancel; useEffect(() => { search(query); }, [query, search]); useEffect(() => stop, [stop]);",
      0,
    ],
    [
      "const stop = search.cancel; useEffect(() => { search(query); }, []); useEffect(() => stop, []);",
      0,
    ],
    [
      "const stop = search.cancel; useEffect(() => { search(query); return () => stop?.(); }, [query, search]);",
      0,
    ],
    [
      "const stop = search.cancel; useEffect(() => { search(query); }, []); useEffect?.(() => { stop(); }, []);",
      0,
    ],
    [
      "const { cancel: stop = () => {} } = search; useEffect(() => { search(query); stop(); }, [query, search]);",
      0,
    ],
    ["useEffect(() => { search?.(query); }, [query, search]);", 1],
    [
      "useEffect(() => { search(query); return () => { search.cancel(); search(query); }; }, [query, search]);",
      1,
    ],
    [
      "const alias = search; alias.cancel = () => {}; useEffect(() => { search(query); return () => search.cancel(); }, [query, search]);",
      0,
    ],
    [
      "const cache = { search }; cache.search.cancel = () => {}; useEffect(() => { search(query); return () => search.cancel(); }, [query, search]);",
      0,
    ],
    [
      "const stop = search.cancel; search.cancel = () => {}; useEffect(() => { search(query); return stop; }, [query, search]);",
      0,
    ],
  ])("proves compat teardown without relying on legacy releases: %s", (effects, expected) => {
    const result = runRule(
      debounceNoCleanup,
      `import { useEffect, useMemo } from 'react';
      import { debounce } from 'es-toolkit/compat';
      function Search({ query }) {
        const search = useMemo(() => debounce(async (value) => { await load(value); }, 500), []);
        ${effects}
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });

  it.each([
    [
      "useEffect(() => { search(query); }, [search]); useEffect(() => stop, [stop]); useEffect(() => () => search(query), [search]);",
      "[]",
      1,
    ],
    [
      "useEffect(() => { search(query); }, [search]); useEffect(() => () => search(query), [search]); useEffect(() => stop, [stop]);",
      "[]",
      0,
    ],
    [
      "useEffect(() => { search(query); return stop; }, [search]); useEffect(() => () => search(query), [search]);",
      "[]",
      1,
    ],
    [
      "useEffect(() => { search(query); stop(); }, []); useEffect(() => () => search(query), []);",
      "[]",
      1,
    ],
    ["useEffect(() => { search(query); }, [query, search]); useEffect(() => stop, []);", "[]", 0],
    [
      "useEffect(() => { search(query); }, [query, search]); useEffect(() => stop, []);",
      "[query]",
      1,
    ],
    ["useEffect(() => { search(query); }, [query, search]); useEffect(() => stop);", "[query]", 0],
    [
      "useEffect(() => { search(query); }, [query, search]); useLayoutEffect?.(() => stop, [stop]);",
      "[]",
      0,
    ],
    [
      "useEffect(() => { search(query); }, []); useEffect(() => {}, []); useEffect(() => { stop(); }, []);",
      "[]",
      0,
    ],
    [
      "useEffect(() => { search(query); }, []); useEffect(() => { stop(); }, []); useEffect(() => { search(query); }, []);",
      "[]",
      1,
    ],
  ])("replays each compat wrapper's setup and teardown order: %s", (effects, memo, expected) => {
    const result = runRule(
      debounceNoCleanup,
      `import { useEffect, useLayoutEffect, useMemo } from 'react';
      import { debounce } from 'es-toolkit/compat';
      function Search({ query }) {
        const search = useMemo(() => debounce(async (value) => { await load(value); }, 500), ${memo});
        const stop = search?.cancel;
        ${effects}
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });

  it.each([
    [
      "useEffect(() => { search(query); }, [query, search]); useEffect(() => { stop(); }, [query, search]);",
      0,
    ],
    ["useEffect(() => { search(query); }); useEffect(() => { stop(); });", 0],
    [
      "useEffect(() => { search(query); }, [query, search]); useEffect(() => { stop(); }, [query, search, enabled]);",
      0,
    ],
    [
      "useEffect(() => { search(query); }, [query, search, enabled]); useEffect(() => { stop(); }, [query, search]);",
      1,
    ],
    [
      "useEffect(() => { stop(); }, [query, search]); useEffect(() => { search(query); }, [query, search]);",
      1,
    ],
    [
      "useEffect(() => { search(query); }, [search]); useEffect(() => stop, [stop]); useEffect(() => () => { if (enabled) search(query); }, [search]);",
      1,
    ],
    [
      "useEffect(() => { search(query); }, [search]); useEffect(() => () => { if (enabled) search(query); }, [search]); useEffect(() => stop, [stop]);",
      0,
    ],
    [
      "const disabled = false; useEffect(() => { search(query); }, [search]); useEffect(() => stop, [stop]); useEffect(() => () => { if (disabled) search(query); }, [search]);",
      0,
    ],
    [
      "useEffect(() => { search(query); return () => { if (enabled) stop(); else search.cancel(); }; }, [search]);",
      0,
    ],
    ["useEffect(() => { search(query); return () => { if (enabled) stop(); }; }, [search]);", 1],
  ])(
    "requires setup co-activation and release on all cleanup branches: %s",
    (effects, expected) => {
      const result = runRule(
        debounceNoCleanup,
        `import { useEffect, useMemo } from 'react';
      import { debounce } from 'es-toolkit/compat';
      function Search({ query, enabled }) {
        const search = useMemo(() => debounce(async (value) => { await load(value); }, 500), []);
        const stop = search.cancel;
        ${effects}
        return null;
      }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(expected);
    },
  );

  it.each([
    [
      "unsupported changing local call guard",
      `import { useEffect, useMemo } from 'react';
      import { debounce } from 'es-toolkit/compat';
      function Search({ query, enabled, other }) {
        const search = useMemo(() => debounce(async (value) => { await load(value); }, 500), []);
        let state = false;
        const next = () => { state = !state; return state; };
        useEffect(() => {
          search(query);
          return () => { search.cancel(); if (next()) search(query); if (next()) search.cancel(); };
        }, [query,search,enabled,other]);
        return null;
      }`,
    ],
    [
      "unsupported mutable local guard",
      `import { useEffect, useMemo } from 'react';
      import { debounce } from 'es-toolkit/compat';
      function Search({ query, enabled, other }) {
        const search = useMemo(() => debounce(async (value) => { await load(value); }, 500), []);
        let state = false;
        const next = () => { state = !state; return state; };
        useEffect(() => {
          search(query);
          return () => { search.cancel(); let flag = enabled; if (flag) search(query); flag = !flag; if (flag) search.cancel(); };
        }, [query,search,enabled,other]);
        return null;
      }`,
    ],
    [
      "unsupported mutable snapshot guards",
      `import { useEffect, useMemo } from 'react';
      import { debounce } from 'es-toolkit/compat';
      import { active as imported, toggle } from './live-state';
      function Search({ query, enabled }) {
        const search = useMemo(() => debounce(async (value) => { await load(value); }, 500), []);
        useEffect(() => {
          search(query);
          return () => { search.cancel(); let live = enabled; const before = live; if (before) search(query); live = !live; const after = live; if (after) search.cancel(); };
        }, [query,search,enabled]);
        return null;
      }`,
    ],
    [
      "unsupported imported guard and opaque call",
      `import { useEffect, useMemo } from 'react';
      import { debounce } from 'es-toolkit/compat';
      import { active as imported, toggle } from './live-state';
      function Search({ query, enabled }) {
        const search = useMemo(() => debounce(async (value) => { await load(value); }, 500), []);
        useEffect(() => {
          search(query);
          return () => { search.cancel(); if (imported) search(query); toggle(); if (imported) search.cancel(); };
        }, [query,search,enabled]);
        return null;
      }`,
    ],
  ])("declines guards and calls outside the finite cleanup contract: %s", (_name, source) => {
    const result = runRule(debounceNoCleanup, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    ["if (enabled) search(query); if (enabled) search.cancel();", 0],
    ["const flag = enabled; if (enabled) search(query); if (flag) search.cancel();", 0],
    ["if (!enabled) search(query); if (!enabled) search.cancel();", 0],
    ["if (enabled) search(query); if (!enabled) search.cancel();", 1],
    ["if (enabled) search(query); if (other) search.cancel();", 1],
    ["if (enabled) search(query); else search.cancel(); if (enabled) search.cancel();", 0],
  ])("correlates only repeated immutable cleanup guards: %s", (cleanup, expected) => {
    const result = runRule(
      debounceNoCleanup,
      `import { useEffect, useMemo } from 'react';
      import { debounce } from 'es-toolkit/compat';
      function Search({ query, enabled, other }) {
        const search = useMemo(() => debounce(async (value) => { await load(value); }, 500), []);
        let state = false;
        const next = () => { state = !state; return state; };
        useEffect(() => {
          search(query);
          return () => { search.cancel(); ${cleanup} };
        }, [query,search,enabled,other]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });

  it.each([
    [
      "let live = enabled; const snapshot = live; if (snapshot) search(query); live = !live; if (snapshot) search.cancel();",
      0,
    ],
    [
      "let live = enabled; const snapshot = live; const alias = snapshot; if (snapshot) search(query); live = !live; if (alias) search.cancel();",
      0,
    ],
    [
      "const snapshot = imported; if (snapshot) search(query); toggle(); if (snapshot) search.cancel();",
      0,
    ],
    [
      "const snapshot = imported; const alias = snapshot; if (snapshot) search(query); toggle(); if (alias) search.cancel();",
      0,
    ],
  ])("uses an actual compat cleanup snapshot rather than a live value: %s", (cleanup, expected) => {
    const result = runRule(
      debounceNoCleanup,
      `import { useEffect, useMemo } from 'react';
      import { debounce } from 'es-toolkit/compat';
      import { active as imported, toggle } from './live-state';
      function Search({ query, enabled }) {
        const search = useMemo(() => debounce(async (value) => { await load(value); }, 500), []);
        useEffect(() => {
          search(query);
          return () => { search.cancel(); ${cleanup} };
        }, [query,search,enabled]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });

  it.each([
    [
      "var value = enabled; useEffect(() => { search(query); }, [value]); var value = false; useEffect(() => { search.cancel(); }, [value]);",
      1,
    ],
    [
      "var value = enabled; const snapshot = value; const alias = snapshot; useEffect(() => { search(query); }, [snapshot]); var value = false; useEffect(() => { search.cancel(); }, [alias]);",
      0,
    ],
    [
      "var value = enabled; const before = value; useEffect(() => { search(query); }, [before]); var value = false; const after = value; useEffect(() => { search.cancel(); }, [after]);",
      1,
    ],
  ])("does not equate separate reads across a var redeclaration: %s", (effects, expected) => {
    const result = runRule(
      debounceNoCleanup,
      `import { useEffect, useMemo } from 'react';
      import { debounce } from 'es-toolkit/compat';
      function Search({ query, enabled }) {
        const search = useMemo(() => debounce(async (value) => { await load(value); }, 500), []);
        ${effects}
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });

  it.each([
    "const stop = search.cancel; search.cancel = () => {};",
    "const { cancel: stop } = search; search.cancel = () => {};",
    "const neverCalled = () => { search.cancel = () => {}; }; const stop = search.cancel;",
    "const neverCalled = () => { (search as any).flush = () => {}; }; const stop = search.cancel;",
    "search.cancel = () => {}; const stop = search.cancel;",
    "(search as any).cancel = () => {}; const stop = search.cancel;",
  ])("declines ambiguous compat release writes instead of proving missing cleanup: %s", (setup) => {
    const result = runRule(
      debounceNoCleanup,
      `import { useEffect, useMemo } from "react";
       import { debounce } from "es-toolkit/compat";
       function Search({ query }) {
         const search = useMemo(() => debounce(async value => { await load(value); }, 500), []);
         ${setup}
         useEffect(() => { search(query); return stop; }, [query, search]);
         return null;
       }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "const stop = takeOwnership(search);",
    "const stop = new Owner(search).cancel;",
    "const stop = search.cancel; takeOwnership(stop);",
    "const { cancel: stop } = search; takeOwnership(stop);",
    "const stop = search.cancel; const finish = stop; new Owner(finish);",
    "const stop = takeOwnership(search.cancel);",
    "let alias = search; const stop = takeOwnership(alias);",
    "const stop = takeOwnership(() => search.cancel());",
    "const release = () => search.cancel(); const stop = takeOwnership(release);",
    "const release = () => search.cancel(); const finish = release; const stop = new Owner(finish).cancel;",
  ])("declines opaque compat scheduler and release ownership handoffs: %s", (setup) => {
    const result = runRule(
      debounceNoCleanup,
      `import { useEffect, useMemo } from "react";
       import { debounce } from "es-toolkit/compat";
       import { takeOwnership, Owner } from "./owner";
       function Search({ query }) {
         const search = useMemo(() => debounce(async value => { await load(value); }, 500), []);
         ${setup}
         useEffect(() => { search(query); return stop; }, [query, search]);
         return null;
       }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "useEffect(() => { search(query); return externalCleanup; }, [query, search]);",
    "useEffect(() => { search(query); }, [query, search]); useEffect(() => externalCleanup, [search]);",
    "useEffect(() => { search(query); return () => externalCleanup(); }, [query, search]);",
  ])(
    "declines an unproven returned compat cleanup instead of assuming it cannot release: %s",
    (effects) => {
      const result = runRule(
        debounceNoCleanup,
        `import { useEffect, useMemo } from "react";
       import { debounce } from "es-toolkit/compat";
       import { externalCleanup } from "./owner";
       function Search({ query }) {
         const search = useMemo(() => debounce(async value => { await load(value); }, 500), []);
         ${effects}
         return null;
       }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it("flags a useRef debounce doing DOM work, driven from an effect, with no cancel cleanup", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function Input() {
        const debounced = useRef(debounce((value) => {
          document.title = value;
        }, 200));
        useEffect(() => {
          debounced.current(value);
        }, [value]);
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a throttle variant doing DOM work driven from an effect", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function Scroller() {
        const measure = useMemo(() => throttle(() => {
          window.requestAnimationFrame(update);
        }, 100), []);
        useEffect(() => {
          measure();
        }, [measure]);
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a namespace-imported lodash debounce doing async work driven from an effect", () => {
    const result = runRule(
      debounceNoCleanup,
      `import _ from 'lodash';
      function Search() {
        const search = useMemo(() => _.debounce(async (value) => {
          await fetchResults(value);
        }, 500), []);
        useEffect(() => {
          search(query);
        }, [query, search]);
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores debounce calls inside uninvoked nested effect helpers", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function Search() {
        const search = useMemo(() => debounce(async (value) => {
          await fetchResults(value);
        }, 500), []);
        useEffect(() => {
          const runSearch = () => search(query);
          registerDebugHelper(runSearch);
        }, [query, search]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("tracks debounce calls through invoked nested effect helpers", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function Search() {
        const search = useMemo(() => debounce(async (value) => {
          await fetchResults(value);
        }, 500), []);
        useEffect(() => {
          const runSearch = () => search(query);
          runSearch();
        }, [query, search]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags the standalone lodash.debounce package import", () => {
    const result = runRule(
      debounceNoCleanup,
      `import debounce from 'lodash.debounce';
      function Search() {
        const search = useMemo(() => debounce(async (value) => {
          await fetchResults(value);
        }, 500), []);
        useEffect(() => {
          search(query);
        }, [query, search]);
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags the lodash-es/debounce subpath import", () => {
    const result = runRule(
      debounceNoCleanup,
      `import debounce from 'lodash-es/debounce';
      function Search() {
        const search = useMemo(() => debounce(async (value) => {
          await fetchResults(value);
        }, 500), []);
        useEffect(() => {
          search(query);
        }, [query, search]);
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a debounced named callback resolved through a same-scope binding", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function Search() {
        const runQuery = async (value) => {
          await fetchResults(value);
        };
        const search = useMemo(() => debounce(runQuery, 500), [runQuery]);
        useEffect(() => {
          search(query);
        }, [query, search]);
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag when a useEffect cleanup cancels the debounce", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function Search() {
        const search = useMemo(() => debounce(async (value) => {
          await fetchResults(value);
        }, 500), []);
        useEffect(() => {
          search(query);
        }, [query, search]);
        useEffect(() => () => search.cancel(), [search]);
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag returning the cancel method reference from an effect (lodash cancel handed off uninvoked)", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function Search() {
        const search = useMemo(() => debounce(async (value) => {
          await fetchResults(value);
        }, 500), []);
        useEffect(() => {
          search(query);
        }, [query, search]);
        useEffect(() => search.cancel, [search]);
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag returning the cancel method reference from an effect block", () => {
    const result = runRule(
      debounceNoCleanup,
      `import { debounce } from "lodash";
       function Search() {
         const search = useMemo(() => debounce(runSearch, 250), []);
         useEffect(() => {
           search(query);
           return search.cancel;
         }, [search, query]);
         return null;
       }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag passing the cancel method to react-use's useUnmount", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function Search() {
        const search = useMemo(() => debounce(async (value) => {
          await fetchResults(value);
        }, 500), []);
        useEffect(() => {
          search(query);
        }, [query, search]);
        useUnmount(search.cancel);
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the exhaustive-deps ref-capture cleanup (alias cancelled on unmount)", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function Input() {
        const debounced = useRef(debounce((value) => {
          document.title = value;
        }, 200));
        useEffect(() => {
          debounced.current(value);
          const fn = debounced.current;
          return () => fn.cancel();
        }, [value]);
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a custom hook that returns the debounced binding (caller owns the cleanup)", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      export function useDebouncedSearch(setQuery) {
        const search = useMemo(() => debounce(async (value) => {
          await fetchResults(value);
        }, 500), [setQuery]);
        useEffect(() => {
          search(initialQuery);
        }, [search]);
        return search;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a custom hook that returns the binding inside an object", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      export function useDebouncedSearch(setQuery) {
        const search = useMemo(() => debounce(async (value) => {
          await fetchResults(value);
        }, 500), [setQuery]);
        useEffect(() => {
          search(initialQuery);
        }, [search]);
        return { search };
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a debounced useState-setter commit (a post-unmount setter is a React 18 no-op)", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function ColorPicker() {
        const [color, setColor] = useState('#fff');
        const commitColor = useMemo(() => debounce(setColor, 300), []);
        useEffect(() => {
          commitColor(draftColor);
        }, [draftColor, commitColor]);
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a debounced parent-notification prop callback (benign late callback)", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function Slider({ onValueChange }) {
        const notifyParent = useMemo(() => debounce((value) => {
          onValueChange(value);
        }, 200), [onValueChange]);
        useEffect(() => {
          notifyParent(value);
        }, [value, notifyParent]);
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a debounced handler only wired to render event handlers, not an effect", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function Search() {
        const search = useMemo(() => debounce(async (value) => {
          await fetchResults(value);
        }, 500), []);
        return <input onChange={(event) => search(event.target.value)} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an autosave-named debounce where flush, not cancel, is the correct teardown", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function Editor({ doc }) {
        const saveDraft = useMemo(() => debounce(async () => {
          await api.putDraft(doc);
        }, 300), [doc]);
        useEffect(() => {
          saveDraft();
        }, [doc, saveDraft]);
        useEffect(() => () => saveDraft.flush(), [saveDraft]);
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not mistake an ordinary cancel helper call for teardown", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function Search() {
        const search = useMemo(() => debounce(async () => {
          await fetchResults();
        }, 300), []);
        const cancel = (value) => value.cancel();
        cancel(search);
        useEffect(() => { search(); }, [search]);
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat async binding names as save-like teardown", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function Search({ query }) {
        const asyncSearch = useMemo(() => debounce(async () => {
          await fetchResults(query);
        }, 300), [query]);
        useEffect(() => {
          asyncSearch();
        }, [asyncSearch]);
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a debounced body guarded by a null ref early return (unmount-guarded work)", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function HrefPopover() {
        const reposition = useMemo(() => debounce(() => {
          if (!paperRef.current) return;
          window.requestAnimationFrame(update);
        }, 100), []);
        useEffect(() => {
          reposition();
        }, [reposition]);
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a leading-edge-only debounce with trailing: false", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function Search() {
        const search = useMemo(() => debounce(async (value) => {
          await fetchResults(value);
        }, 500, { trailing: false }), []);
        useEffect(() => {
          search(query);
        }, [query, search]);
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("only trusts statically resolved trailing option keys", () => {
    const dynamicResult = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
       function Search() {
         const trailing = "leading";
         const search = useMemo(() => debounce(async (value) => {
           await fetchResults(value);
         }, 250, { [trailing]: false }), []);
         useEffect(() => { search(query); }, [search, query]);
         return null;
       }`,
    );
    const staticResult = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
       function Search() {
         const search = useMemo(() => debounce(async (value) => {
           await fetchResults(value);
         }, 250, { ["trailing"]: false }), []);
         useEffect(() => { search(query); }, [search, query]);
         return null;
       }`,
    );
    expect(dynamicResult.diagnostics).toHaveLength(1);
    expect(staticResult.diagnostics).toHaveLength(0);
  });

  it("does not flag a non-lodash custom debounce", () => {
    const result = runRule(
      debounceNoCleanup,
      `import { debounce } from './my-utils';
      function Search() {
        const search = useMemo(() => debounce(async (value) => {
          await fetchResults(value);
        }, 500), []);
        useEffect(() => {
          search(query);
        }, [query, search]);
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a module-scope debounce outside a hook", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      const search = debounce(setQuery, 500);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the debounce result is not assigned to a binding", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
      function Search() {
        useMemo(() => debounce(setQuery, 500), []);
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Hoisted null-ref guard (TS narrowing idiom) instead of inline if-test", () => {
    const result = runRule(
      debounceNoCleanup,
      `import { debounce, throttle } from 'lodash';

function Popover() {
  const reposition = useMemo(() => debounce(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    window.requestAnimationFrame(() => positionPopover(anchor));
  }, 100), []);
  useEffect(() => {
    reposition();
  }, [reposition]);
  return null;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Guard hoisted via optional-chained measurement before early return", () => {
    const result = runRule(
      debounceNoCleanup,
      `import { debounce, throttle } from 'lodash';

function Tooltip() {
  const measure = useMemo(() => debounce(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    window.requestAnimationFrame(() => place(rect));
  }, 150), []);
  useEffect(() => {
    measure();
  }, [measure]);
  return null;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Destructured cancel returned as effect cleanup", () => {
    const result = runRule(
      debounceNoCleanup,
      `import { debounce, throttle } from 'lodash';

function Search() {
  const search = useMemo(() => debounce(async (value) => {
    const results = await fetchResults(value);
    setResults(results);
  }, 500), []);
  useEffect(() => {
    search(query);
    const { cancel } = search;
    return () => cancel();
  }, [query, search]);
  return null;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Cancel-on-unmount through a latest-ref holding the debounced fn", () => {
    const result = runRule(
      debounceNoCleanup,
      `import { debounce, throttle } from 'lodash';

function Search({ query }) {
  const search = useMemo(() => debounce(async (value) => {
    setResults(await fetchResults(value));
  }, 300), []);
  const searchRef = useRef(search);
  useEffect(() => {
    search(query);
  }, [query, search]);
  useEffect(() => {
    return () => searchRef.current.cancel();
  }, []);
  return null;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Cancel delegated to a same-file reusable cleanup hook", () => {
    const result = runRule(
      debounceNoCleanup,
      `import { debounce, throttle } from 'lodash';

const useCancelOnUnmount = (debounced) => {
  useEffect(() => () => debounced.cancel(), [debounced]);
};
function Search({ query }) {
  const search = useMemo(() => debounce(async (value) => {
    setResults(await fetchResults(value));
  }, 300), []);
  useCancelOnUnmount(search);
  useEffect(() => {
    search(query);
  }, [query, search]);
  return null;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: trailing:false passed via a module-scope options constant", () => {
    const result = runRule(
      debounceNoCleanup,
      `import { debounce, throttle } from 'lodash';

const TRACK_OPTIONS = { leading: true, trailing: false };
function Tracker({ position }) {
  const report = useMemo(() => debounce(async (value) => {
    await api.reportScroll(value);
  }, 500, TRACK_OPTIONS), []);
  useEffect(() => {
    report(position);
  }, [position, report]);
  return null;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: useWindowWidth: throttled no-op setter reading window.innerWidth, listener removed on unmount", () => {
    const result = runRule(
      debounceNoCleanup,
      `import { debounce, throttle } from 'lodash';

function useWindowWidth() {
  const [width, setWidth] = useState(0);
  const handleResize = useMemo(() => throttle(() => {
    setWidth(window.innerWidth);
  }, 100), []);
  useEffect(() => {
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [handleResize]);
  return width;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Callback parameter named `document` (domain noun) in a benign parent-notification debounce", () => {
    const result = runRule(
      debounceNoCleanup,
      `import { debounce, throttle } from 'lodash';

function DocumentEditor({ document, onDocumentChange }) {
  const notifyChange = useMemo(() => debounce((document) => {
    onDocumentChange(document);
  }, 400), [onDocumentChange]);
  useEffect(() => {
    notifyChange(document);
  }, [document, notifyChange]);
  return null;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Debounced localStorage persistence where the trailing write IS the desired behavior", () => {
    const result = runRule(
      debounceNoCleanup,
      `import { debounce, throttle } from 'lodash';

function useColumnWidthStorage(columnWidths) {
  const writeWidths = useMemo(() => debounce((widths) => {
    window.localStorage.setItem('table-column-widths', JSON.stringify(widths));
  }, 300), []);
  useEffect(() => {
    writeWidths(columnWidths);
  }, [columnWidths, writeWidths]);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Debounced fire-and-forget analytics with .catch(noop)", () => {
    const result = runRule(
      debounceNoCleanup,
      `import { debounce, throttle } from 'lodash';

function SearchBox({ query }) {
  const trackSearch = useMemo(() => debounce((value) => {
    analytics.track('search-input', { value }).catch(() => {});
  }, 1000), []);
  useEffect(() => {
    if (query) trackSearch(query);
  }, [query, trackSearch]);
  return null;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a debounced fetch with no cancel anywhere", () => {
    const result = runRule(
      debounceNoCleanup,
      `import { debounce } from 'lodash';
       function Search({ query }) {
         const search = useMemo(() => debounce(async (value) => {
           const results = await fetchResults(value);
           setResults(results);
         }, 500), []);
         useEffect(() => {
           search(query);
         }, [query, search]);
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a debounced DOM write with no cancel", () => {
    const result = runRule(
      debounceNoCleanup,
      `import { debounce } from 'lodash';
       function Title({ title }) {
         const apply = useMemo(() => debounce((value) => {
           document.title = value;
         }, 300), []);
         useEffect(() => {
           apply(title);
         }, [title, apply]);
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("tracks computed factories and flow-stable option bindings", () => {
    const mutatedBefore = runRule(
      debounceNoCleanup,
      `import * as lodash from "lodash";
       import { useEffect, useMemo } from "react";
       function MutatedBefore({ query }) {
         const options = { trailing: false };
         options.trailing = true;
         const search = useMemo(() => lodash["debounce"](async (value) => {
           await fetchResults(value);
         }, 250, options), []);
         useEffect(() => search(query), [query, search]);
       }`,
    );
    const mutatedAfter = runRule(
      debounceNoCleanup,
      `import * as lodash from "lodash";
       import { useEffect, useMemo } from "react";
       function MutatedAfter({ query }) {
         const options = { trailing: false };
         const search = useMemo(() => lodash[\`debounce\`](async (value) => {
           await fetchResults(value);
         }, 250, options), []);
         options.trailing = true;
         useEffect(() => search(query), [query, search]);
       }`,
    );
    const shadowedOptions = runRule(
      debounceNoCleanup,
      `import * as lodash from "lodash";
       import { useEffect, useMemo } from "react";
       const outerOptions = { trailing: false };
       function ShadowedOptions({ query }) {
         const outerOptions = { trailing: true };
         const search = useMemo(() => lodash["debounce"](async (value) => {
           await fetchResults(value);
         }, 250, outerOptions), []);
         useEffect(() => search(query), [query, search]);
       }`,
    );
    expect(mutatedBefore.diagnostics).toHaveLength(1);
    expect(mutatedAfter.diagnostics).toHaveLength(0);
    expect(shadowedOptions.diagnostics).toHaveLength(1);
  });

  it("tracks transparent wrappers around lodash namespace receivers", () => {
    const castNamespace = runRule(
      debounceNoCleanup,
      `import * as lodash from "lodash";
       function Search({ query }) {
         const search = useMemo(() => (lodash as any).debounce(async (value) => {
           await fetchResults(value);
         }, 250), []);
         useEffect(() => search(query), [query, search]);
       }`,
    );
    const assertedNamespace = runRule(
      debounceNoCleanup,
      `import * as lodash from "lodash";
       function Search({ query }) {
         const search = useMemo(() => lodash!.debounce(async (value) => {
           await fetchResults(value);
         }, 250), []);
         useEffect(() => search(query), [query, search]);
       }`,
    );
    const shadowedNamespace = runRule(
      debounceNoCleanup,
      `import * as lodash from "lodash";
       function Search({ query }, lodash) {
         const search = useMemo(() => (lodash as any).debounce(async (value) => {
           await fetchResults(value);
         }, 250), []);
         useEffect(() => search(query), [query, search]);
       }`,
    );
    const unrelatedNamespace = runRule(
      debounceNoCleanup,
      `import * as lodash from "lodash";
       function Search({ query }) {
         const search = useMemo(() => (custom as any).debounce(async (value) => {
           await fetchResults(value);
         }, 250), []);
         useEffect(() => search(query), [query, search]);
       }`,
    );
    expect(castNamespace.diagnostics).toHaveLength(1);
    expect(assertedNamespace.diagnostics).toHaveLength(1);
    expect(shadowedNamespace.diagnostics).toHaveLength(0);
    expect(unrelatedNamespace.diagnostics).toHaveLength(0);
  });

  it("requires the matching computed debounce release", () => {
    const acquireOnly = runRule(
      debounceNoCleanup,
      `import * as lodash from "lodash";
       function Search({ query }) {
         const search = useMemo(() => lodash["debounce"](async (value) => {
           await fetchResults(value);
         }, 250), []);
         useEffect(() => search(query), [query, search]);
       }`,
    );
    const matchingRelease = runRule(
      debounceNoCleanup,
      `import * as lodash from "lodash";
       function Search({ query }) {
         const search = useMemo(() => lodash["debounce"](async (value) => {
           await fetchResults(value);
         }, 250), []);
         useEffect(() => search(query), [query, search]);
         useEffect(() => () => search[\`cancel\`](), [search]);
       }`,
    );
    const wrongRelease = runRule(
      debounceNoCleanup,
      `import * as lodash from "lodash";
       function Search({ query, other }) {
         const search = useMemo(() => lodash["debounce"](async (value) => {
           await fetchResults(value);
         }, 250), []);
         useEffect(() => search(query), [query, search]);
         useEffect(() => () => other[\`cancel\`](), [other]);
       }`,
    );
    expect(acquireOnly.diagnostics).toHaveLength(1);
    expect(matchingRelease.diagnostics).toHaveLength(0);
    expect(wrongRelease.diagnostics).toHaveLength(1);
  });

  it("does not treat a persistent boolean ref as an unmount-cleared DOM ref", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
       function Search() {
         const alive = useRef(true);
         const search = useMemo(() => debounce(() => {
           if (!alive.current) return;
           document.title = "late";
         }, 100), []);
         useEffect(() => search(), [search]);
         return null;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a ref parameter as unmount-cleared", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
       function Search({ targetRef }) {
         const search = useMemo(() => debounce(() => {
           if (!targetRef.current) return;
           document.title = "late";
         }, 100), [targetRef]);
         useEffect(() => search(), [search]);
         return null;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not suppress DOM work based on a sync-prefixed binding name", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
       function Search() {
         const syncPosition = useMemo(() => debounce(() => {
           document.body.scrollTop = 0;
         }, 100), []);
         useEffect(() => syncPosition(), [syncPosition]);
         return null;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("treats a returned debounce alias as caller-owned cleanup", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
       function useSearch() {
         const search = useMemo(() => debounce(() => {
           document.title = "late";
         }, 100), []);
         const exposedSearch = search;
         useEffect(() => exposedSearch(), [exposedSearch]);
         return exposedSearch;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("tracks hook calls through transparent type wrappers", () => {
    const result = runRule(
      debounceNoCleanup,
      `${LODASH_DEBOUNCE_IMPORT}
       function Search() {
         const search = (useMemo(() => debounce(() => {
           document.title = "late";
         }, 100), []) as any)!;
         useEffect(() => search(), [search]);
         return null;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
