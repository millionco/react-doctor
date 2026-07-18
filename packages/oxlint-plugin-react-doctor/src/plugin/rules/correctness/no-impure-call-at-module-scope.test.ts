import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noImpureCallAtModuleScope } from "./no-impure-call-at-module-scope.js";

describe("no-impure-call-at-module-scope", () => {
  it("flags Math.random() sampling at module scope (retailer-visitor shape)", () => {
    const result = runRule(
      noImpureCallAtModuleScope,
      `const SHOULD_TRACK = Math.random() * 100 < SAMPLE_RATE;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("Math.random()");
  });

  it("flags new Date().getTimezoneOffset() date math at module scope", () => {
    const result = runRule(
      noImpureCallAtModuleScope,
      `const USER_TIMEZONE_OFFSET_IN_MILLIS = new Date().getTimezoneOffset() * 60000;`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("new Date()");
  });

  it("flags a bare new Date() constant at module scope", () => {
    const result = runRule(noImpureCallAtModuleScope, `const CURRENT_TIMESTAMP = new Date();`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags Date.now() at module scope", () => {
    const result = runRule(noImpureCallAtModuleScope, `const RENDERED = Date.now();`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a module-scope timestamp behind a primitive value wrapper", () => {
    const result = runRule(noImpureCallAtModuleScope, `const renderedAt = String(Date.now());`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags performance.now() at module scope", () => {
    const result = runRule(noImpureCallAtModuleScope, `const MARK = performance.now();`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a static class-field initializer", () => {
    const result = runRule(
      noImpureCallAtModuleScope,
      `
      class Sampler {
        static sample = Math.random();
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an exported module-scope constant", () => {
    const result = runRule(noImpureCallAtModuleScope, `export const RATE = Math.random();`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag the same call inside a function body", () => {
    const result = runRule(
      noImpureCallAtModuleScope,
      `
      function sample() {
        const value = Math.random();
        return value;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the same call inside a component", () => {
    const result = runRule(
      noImpureCallAtModuleScope,
      `
      const Clock = () => {
        const now = Date.now();
        return null;
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a lazy getter arrow", () => {
    const result = runRule(noImpureCallAtModuleScope, `const getNow = () => Date.now();`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag new Date(timestamp) with an argument", () => {
    const result = runRule(noImpureCallAtModuleScope, `const AT = new Date(1700000000000);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag crypto.randomUUID() (dropped per revision)", () => {
    const result = runRule(noImpureCallAtModuleScope, `const INSTANCE = crypto.randomUUID();`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a non-static (instance) class field", () => {
    const result = runRule(
      noImpureCallAtModuleScope,
      `
      class Sampler {
        sample = Math.random();
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a per-process-named binding", () => {
    const result = runRule(noImpureCallAtModuleScope, `const bootTime = Date.now();`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags init/module-load per-process names", () => {
    expect(
      runRule(noImpureCallAtModuleScope, `const INIT_TIMESTAMP = Date.now();`).diagnostics,
    ).toHaveLength(1);
    expect(
      runRule(noImpureCallAtModuleScope, `const moduleLoadTime = performance.now();`).diagnostics,
    ).toHaveLength(1);
  });

  it("flags camelCase per-process uptime names", () => {
    expect(
      runRule(noImpureCallAtModuleScope, `const startTime = Date.now();`).diagnostics,
    ).toHaveLength(1);
    expect(
      runRule(noImpureCallAtModuleScope, `const appBootTime = Date.now();`).diagnostics,
    ).toHaveLength(1);
    expect(
      runRule(noImpureCallAtModuleScope, `const serverStartedAt = Date.now();`).diagnostics,
    ).toHaveLength(1);
    expect(
      runRule(noImpureCallAtModuleScope, `const SERVER_START_TIME = Date.now();`).diagnostics,
    ).toHaveLength(1);
  });

  it("flags a jotai atom seeded with Date.now()", () => {
    const result = runRule(
      noImpureCallAtModuleScope,
      `
      import { atom } from "jotai";
      export const appRefreshTriggerAtom = atom<number>(Date.now());
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags state-container factory seeds", () => {
    expect(
      runRule(noImpureCallAtModuleScope, `export const lastUpdated = writable(Date.now());`)
        .diagnostics,
    ).toHaveLength(1);
    expect(
      runRule(noImpureCallAtModuleScope, `const clock$ = new BehaviorSubject(Date.now());`)
        .diagnostics,
    ).toHaveLength(1);
  });

  it("does not flag a static field of a class created inside a factory/mixin", () => {
    const result = runRule(
      noImpureCallAtModuleScope,
      `export const withInstanceKey = (Base) => class extends Base { static key = Math.random().toString(36); };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when Date is shadowed by a local binding", () => {
    const result = runRule(
      noImpureCallAtModuleScope,
      `
      const Date = FakeDate;
      const NOW = new Date();
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag inside test/story files (test-noise)", () => {
    const result = runRule(noImpureCallAtModuleScope, `const NOW = Date.now();`, {
      filename: "src/widget.stories.tsx",
    });
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a Math.random()-based per-process tab/client id", () => {
    const result = runRule(
      noImpureCallAtModuleScope,
      `const tabId = Math.random().toString(36).slice(2);
const channel = new BroadcastChannel("cart-sync");
export const broadcastCartChange = (payload: unknown) => {
  channel.postMessage({ sourceId: tabId, payload });
};
export const isOwnMessage = (message: { sourceId: string }) => message.sourceId === tabId;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet: Mutable external-store seed refreshed on demand (unkey query-time-provider — a literal wild hit)", () => {
    const result = runRule(
      noImpureCallAtModuleScope,
      `let lastRefreshedAt = Date.now();
const listeners = new Set<() => void>();
export const refreshQueryTime = () => {
  lastRefreshedAt = Date.now();
  listeners.forEach((notify) => notify());
};
export const getQueryTimeSnapshot = () => lastRefreshedAt;
export const subscribeQueryTime = (notify: () => void) => {
  listeners.add(notify);
  return () => listeners.delete(notify);
};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: SSR-guarded ternary where the server branch is a deterministic constant", () => {
    const result = runRule(
      noImpureCallAtModuleScope,
      `const hydrationBaselineMs = typeof window === "undefined" ? 0 : performance.now();
export const timeSinceHydration = () => performance.now() - hydrationBaselineMs;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a module epoch used as an origin for elapsed-time deltas", () => {
    const result = runRule(
      noImpureCallAtModuleScope,
      `const moduleEpoch = Date.now();
export const uptimeMs = () => Date.now() - moduleEpoch;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags per-process seeds feeding a deterministic generator", () => {
    const result = runRule(
      noImpureCallAtModuleScope,
      `import prand from "pure-rand";
const seed = Date.now() ^ (Math.random() * 0x100000000);
const rng = prand.xoroshiro128plus(seed);
export const randomIntBetween = (min: number, max: number) =>
  prand.unsafeUniformIntDistribution(min, max, rng);`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("stays quiet: Module-level cache expiry seeded as already-expired", () => {
    const result = runRule(
      noImpureCallAtModuleScope,
      `const CACHE_TTL_MS = 60_000;
let cachedRates: Record<string, number> | null = null;
let cacheExpiresAt = Date.now();
export const getExchangeRates = async () => {
  if (cachedRates && Date.now() < cacheExpiresAt) return cachedRates;
  cachedRates = await fetchRates();
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  return cachedRates;
};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags module-init duration telemetry", () => {
    const result = runRule(
      noImpureCallAtModuleScope,
      `const initStartMs = performance.now();
export const searchIndex = buildSearchIndex(documents);
const indexInitDurationMs = performance.now() - initStartMs;
reportTiming("search-index-init", indexInitDurationMs);`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags nondeterministic PreviewProps fixture defaults", () => {
    const result = runRule(
      noImpureCallAtModuleScope,
      `const previewDefaults = {
  environment: "production",
  organization: "My Organization",
  failedAt: new Date().toISOString(),
};
export const DeploymentFailureEmail = ({ failedAt, environment }: DeploymentFailureProps) => (
  <p>Deployment to {environment} failed at {failedAt}</p>
);
DeploymentFailureEmail.PreviewProps = previewDefaults;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags NOW-named module-load timestamps", () => {
    expect(
      runRule(noImpureCallAtModuleScope, `export const NOW = Date.now();`).diagnostics,
    ).toHaveLength(1);
    expect(
      runRule(noImpureCallAtModuleScope, `const NOW_MS = new Date().getTime();`).diagnostics,
    ).toHaveLength(1);
  });

  it("still flags new Date() inside a store's module-scope initialState (zustand calendar idiom)", () => {
    const result = runRule(
      noImpureCallAtModuleScope,
      `const initialState = {
        calendars: [],
        selectedDate: new Date(),
        isLoading: false,
      };
      export const useCalendarStore = create((set) => ({
        ...initialState,
        reset: () => set(initialState),
      }));`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("new Date()");
  });

  it("still flags a frozen const wall-clock read with a value-shaped name", () => {
    const result = runRule(
      noImpureCallAtModuleScope,
      `const currentYear = new Date().getFullYear ? new Date() : new Date();
       export const copyrightDate = Date.now();
       export const Footer = () => <span>{copyrightDate}</span>;`,
    );
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
  });
});

describe("audit regressions", () => {
  it("allows browser-only logical branches", () => {
    const result = runRule(
      noImpureCallAtModuleScope,
      `const first = typeof window !== "undefined" && performance.now();
       const second = typeof document === "undefined" || Date.now();`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("resolves an unreassigned browser guard binding", () => {
    const result = runRule(
      noImpureCallAtModuleScope,
      `const isBrowser = typeof window !== "undefined";
       const renderedAt = isBrowser && Date.now();`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags logical branches that execute on the server", () => {
    const result = runRule(
      noImpureCallAtModuleScope,
      `const first = typeof window === "undefined" && performance.now();
       const second = typeof document !== "undefined" || Date.now();`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not trust a typeof guard on a shadowed browser-global name", () => {
    const result = runRule(
      noImpureCallAtModuleScope,
      `const window = {};
       const renderedAt = typeof window !== "undefined" && Date.now();`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("uses the server polarity of a typeof window conditional", () => {
    const result = runRule(
      noImpureCallAtModuleScope,
      `const requestTime = typeof window === "undefined" ? Date.now() : 0;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("follows nondeterministic calls through factory arguments", () => {
    const result = runRule(noImpureCallAtModuleScope, `const requestTime = identity(Date.now());`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an unreassigned module let", () => {
    const result = runRule(noImpureCallAtModuleScope, `let requestTime = Date.now();`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a nondeterministic direct default export", () => {
    const result = runRule(noImpureCallAtModuleScope, `export default Date.now();`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a nondeterministic immediately invoked function", () => {
    const result = runRule(noImpureCallAtModuleScope, `const requestTime = (() => Date.now())();`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an immediately invoked function through a TypeScript wrapper", () => {
    const result = runRule(
      noImpureCallAtModuleScope,
      `const requestTime = ((() => Date.now()) as () => number)();`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a callback passed to another function as immediate", () => {
    const result = runRule(
      noImpureCallAtModuleScope,
      `const requestTime = defer(() => Date.now());`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
