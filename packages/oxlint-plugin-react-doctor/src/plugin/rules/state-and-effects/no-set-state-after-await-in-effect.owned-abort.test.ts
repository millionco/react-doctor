import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSetStateAfterAwaitInEffect } from "./no-set-state-after-await-in-effect.js";

interface AbortShortcutFixtureOptions {
  owner?: string;
  cleanup?: string;
  prefix?: string;
}

interface AbortShortcutCase {
  name: string;
  code: string;
  expectedTargetCount: number;
}

const createExample = (
  work: string,
  {
    owner = "const controller = new AbortController();",
    cleanup = "return () => controller.abort();",
    prefix = "",
  }: AbortShortcutFixtureOptions = {},
): string => `
import { useEffect, useState } from "react";
${prefix}
const Example = ({ load, loadUser, identifier, url, enabled, options, afterGuard }) => {
  const [value, setValue] = useState(null);
  useEffect(() => {
    ${owner}
    const run = async () => {
      ${work}
    };
    void run();
    ${cleanup}
  }, [load, loadUser, identifier, url, enabled, options, afterGuard]);
  return <output>{String(value)}</output>;
};
`;

const cases: ReadonlyArray<AbortShortcutCase> = [
  {
    name: "native-fetch-signal-without-continuation-guard",
    code: createExample(
      `const result = await fetch(url, { signal: controller.signal }); setValue(result);`,
      {
        cleanup: `return () => { controller.abort(); };`,
      },
    ),
    expectedTargetCount: 1,
  },
  {
    name: "opaque-imported-operation-ignores-signal",
    code: createExample(
      `const result = await loadUser(url, { signal: controller.signal }); setValue(result);`,
      {
        cleanup: `return () => { controller.abort(); };`,
      },
    ),
    expectedTargetCount: 1,
  },
  {
    name: "local-operation-ignores-signal",
    code: createExample(
      `const ignoreSignal = async (_signal) => null; const result = await ignoreSignal(controller.signal); setValue(result);`,
      {
        cleanup: `return () => { controller.abort(); };`,
      },
    ),
    expectedTargetCount: 0,
  },
  {
    name: "false-fulfilling-abort-wait-unguarded",
    code: createExample(
      `const wait = (signal) => new Promise((resolve) => signal.addEventListener("abort", () => resolve(false), { once: true })); const result = await wait(controller.signal); setValue(result);`,
      {
        cleanup: `return () => { controller.abort(); };`,
      },
    ),
    expectedTargetCount: 0,
  },
  {
    name: "caught-native-fetch-abort",
    code: createExample(
      `const result = await fetch(url, { signal: controller.signal }).catch(() => null); setValue(result);`,
      {
        cleanup: `return () => { controller.abort(); };`,
      },
    ),
    expectedTargetCount: 0,
  },
  {
    name: "race-can-fulfill-without-cancelled-operation",
    code: createExample(
      `const result = await Promise.race([fetch(url, { signal: controller.signal }), Promise.resolve(null)]); setValue(result);`,
      {
        cleanup: `return () => { controller.abort(); };`,
      },
    ),
    expectedTargetCount: 1,
  },
  {
    name: "signal-property-overwritten",
    code: createExample(
      `const result = await fetch(url, { signal: controller.signal, signal: undefined }); setValue(result);`,
      {
        cleanup: `return () => { controller.abort(); };`,
      },
    ),
    expectedTargetCount: 1,
  },
  {
    name: "spread-can-overwrite-signal",
    code: createExample(
      `const result = await fetch(url, { signal: controller.signal, ...options }); setValue(result);`,
      {
        cleanup: `return () => { controller.abort(); };`,
      },
    ),
    expectedTargetCount: 1,
  },
  {
    name: "signal-appears-in-unconsumed-argument",
    code: createExample(
      `const result = await loadUser(controller.signal, url); setValue(result);`,
      {
        cleanup: `return () => { controller.abort(); };`,
      },
    ),
    expectedTargetCount: 1,
  },
  {
    name: "already-fulfilled-request-has-earlier-abort-reaction",
    code: createExample(
      `const request = fetch(url, { signal: controller.signal }); request.then(() => controller.abort()); const result = await request; setValue(result);`,
      {
        cleanup: `return () => { controller.abort(); };`,
      },
    ),
    expectedTargetCount: 1,
  },
  {
    name: "explicit-cancelled-flag-after-all-suspensions",
    code: createExample(
      `const result = await fetch(url, { signal: controller.signal }); if (cancelled) return; setValue(result);`,
      {
        owner: `let cancelled = false; const controller = new AbortController();`,
        cleanup: `return () => { cancelled = true; controller.abort(); };`,
      },
    ),
    expectedTargetCount: 0,
  },
  {
    name: "explicit-cancelled-flag-with-opaque-helper",
    code: createExample(
      `const result = await loadUser(url, { signal: controller.signal }); if (cancelled) return; setValue(result);`,
      {
        owner: `let cancelled = false; const controller = new AbortController();`,
        cleanup: `return () => { cancelled = true; controller.abort(); };`,
      },
    ),
    expectedTargetCount: 0,
  },
  {
    name: "later-await-invalidates-earlier-explicit-guard",
    code: createExample(
      `await fetch(url, { signal: controller.signal }); if (cancelled) return; const result = await loadUser(); setValue(result);`,
      {
        owner: `let cancelled = false; const controller = new AbortController();`,
        cleanup: `return () => { cancelled = true; controller.abort(); };`,
      },
    ),
    expectedTargetCount: 1,
  },
  {
    name: "conditional-cleanup-does-not-guarantee-cancelled",
    code: createExample(
      `const result = await loadUser(url, { signal: controller.signal }); if (cancelled) return; setValue(result);`,
      {
        owner: `let cancelled = false; const controller = new AbortController();`,
        cleanup: `return () => { if (enabled) { cancelled = true; controller.abort(); } };`,
      },
    ),
    expectedTargetCount: 1,
  },
  {
    name: "owned-aborted-early-return",
    code: createExample(
      `const result = await loadUser(url, { signal: controller.signal }); if (controller.signal.aborted) return; setValue(result);`,
      {
        cleanup: `return () => { controller.abort(); };`,
      },
    ),
    expectedTargetCount: 0,
  },
  {
    name: "owned-aborted-positive-branch",
    code: createExample(
      `const result = await loadUser(url, { signal: controller.signal }); if (!controller.signal.aborted) setValue(result);`,
      {
        cleanup: `return () => { controller.abort(); };`,
      },
    ),
    expectedTargetCount: 0,
  },
  {
    name: "wrong-controller-guard",
    code: createExample(
      `const result = await loadUser(url, { signal: controller.signal }); if (other.signal.aborted) return; setValue(result);`,
      {
        owner: `const controller = new AbortController(); const other = new AbortController();`,
        cleanup: `return () => { controller.abort(); };`,
      },
    ),
    expectedTargetCount: 0,
  },
  {
    name: "guard-before-await-is-stale",
    code: createExample(
      `if (controller.signal.aborted) return; const result = await loadUser(url, { signal: controller.signal }); setValue(result);`,
      {
        cleanup: `return () => { controller.abort(); };`,
      },
    ),
    expectedTargetCount: 0,
  },
  {
    name: "wrong-aborted-polarity",
    code: createExample(
      `const result = await loadUser(url, { signal: controller.signal }); if (!controller.signal.aborted) return; setValue(result);`,
      {
        cleanup: `return () => { controller.abort(); };`,
      },
    ),
    expectedTargetCount: 0,
  },
  {
    name: "snapshot-before-await-is-stale",
    code: createExample(
      `const aborted = controller.signal.aborted; const result = await loadUser(url, { signal: controller.signal }); if (aborted) return; setValue(result);`,
      {
        cleanup: `return () => { controller.abort(); };`,
      },
    ),
    expectedTargetCount: 0,
  },
  {
    name: "later-await-invalidates-aborted-guard",
    code: createExample(
      `await fetch(url, { signal: controller.signal }); if (controller.signal.aborted) return; const result = await loadUser(); setValue(result);`,
      {
        cleanup: `return () => { controller.abort(); };`,
      },
    ),
    expectedTargetCount: 1,
  },
  {
    name: "shadowed-abort-constructor",
    code: createExample(
      `const result = await loadUser(url, { signal: controller.signal }); if (controller.signal.aborted) return; setValue(result);`,
      {
        cleanup: `return () => { controller.abort(); };`,
        prefix: `const AbortController = class { signal = { aborted: false }; abort() {} };`,
      },
    ),
    expectedTargetCount: 1,
  },
  {
    name: "controller-abort-replaced",
    code: createExample(
      `controller.abort = () => {}; const result = await loadUser(url, { signal: controller.signal }); if (controller.signal.aborted) return; setValue(result);`,
      {
        cleanup: `return () => { controller.abort(); };`,
      },
    ),
    expectedTargetCount: 0,
  },
  {
    name: "controller-signal-replaced",
    code: createExample(
      `controller.signal = { aborted: false }; const result = await loadUser(url, { signal: controller.signal }); if (controller.signal.aborted) return; setValue(result);`,
      {
        cleanup: `return () => { controller.abort(); };`,
      },
    ),
    expectedTargetCount: 0,
  },
  {
    name: "aborted-getter-overridden",
    code: createExample(
      `Object.defineProperty(controller.signal, "aborted", { get: () => false }); const result = await loadUser(url, { signal: controller.signal }); if (controller.signal.aborted) return; setValue(result);`,
      {
        cleanup: `return () => { controller.abort(); };`,
      },
    ),
    expectedTargetCount: 0,
  },
  {
    name: "abort-prototype-overridden",
    code: createExample(
      `AbortController.prototype.abort = () => {}; const result = await loadUser(url, { signal: controller.signal }); if (controller.signal.aborted) return; setValue(result);`,
      {
        cleanup: `return () => { controller.abort(); };`,
      },
    ),
    expectedTargetCount: 0,
  },
  {
    name: "ambient-constructor-homonym",
    code: createExample(
      `const result = await loadUser(url, { signal: controller.signal }); if (controller.signal.aborted) return; setValue(result);`,
      {
        cleanup: `return () => { controller.abort(); };`,
        prefix: `declare const AbortController: { new(): { signal: { aborted: boolean }; abort(): void } };`,
      },
    ),
    expectedTargetCount: 1,
  },
  {
    name: "controller-escapes-to-visible-replacement",
    code: createExample(
      `const overwrite = (owner) => { owner.abort = () => {}; }; overwrite(controller); const result = await loadUser(url, { signal: controller.signal }); if (controller.signal.aborted) return; setValue(result);`,
      {
        cleanup: `return () => { controller.abort(); };`,
      },
    ),
    expectedTargetCount: 0,
  },
  {
    name: "signal-escapes-to-visible-replacement",
    code: createExample(
      `const overwrite = (signal) => { Object.defineProperty(signal, "aborted", { value: false }); }; overwrite(controller.signal); const result = await loadUser(url, { signal: controller.signal }); if (controller.signal.aborted) return; setValue(result);`,
      {
        cleanup: `return () => { controller.abort(); };`,
      },
    ),
    expectedTargetCount: 0,
  },
  {
    name: "conditional-abort-does-not-establish-owned-guard",
    code: createExample(
      `const result = await loadUser(url, { signal: controller.signal }); if (controller.signal.aborted) return; setValue(result);`,
      {
        cleanup: `return () => { if (enabled) controller.abort(); };`,
      },
    ),
    expectedTargetCount: 1,
  },
  {
    name: "controller-reassigned",
    code: createExample(
      `controller = new AbortController(); const result = await loadUser(url, { signal: controller.signal }); if (controller.signal.aborted) return; setValue(result);`,
      {
        owner: `let controller = new AbortController();`,
        cleanup: `return () => { controller.abort(); };`,
      },
    ),
    expectedTargetCount: 0,
  },
  {
    name: "frozen-documented-correction",
    code: `import { useEffect, useState } from "react";
const Example = ({ id, loadUser, reportError }) => {
  const [user, setUser] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    void loadUser(id, { signal: controller.signal })
      .then((user) => {
        if (!controller.signal.aborted) setUser(user);
      })
      .catch((error) => {
        if (!controller.signal.aborted) reportError(error);
      });
    return () => controller.abort();
  }, [id, loadUser, reportError]);
  return <output>{String(user)}</output>;
};`,
    expectedTargetCount: 0,
  },
  {
    name: "preserve-signal-destructuring-guard",
    code: createExample(
      `const { signal } = controller; const result = await load(identifier, { signal: controller.signal }); if (signal.aborted) return; setValue(result);`,
    ),
    expectedTargetCount: 0,
  },
  {
    name: "preserve-post-await-snapshot-guard",
    code: createExample(
      `const result = await load(identifier, { signal: controller.signal }); const aborted = controller.signal.aborted; if (aborted) return; setValue(result);`,
    ),
    expectedTargetCount: 0,
  },
  {
    name: "preserve-local-native-predicate",
    code: createExample(
      `const isCurrent = () => !controller.signal.aborted; const result = await load(identifier, { signal: controller.signal }); if (isCurrent()) setValue(result);`,
    ),
    expectedTargetCount: 0,
  },
  {
    name: "preserve-compound-native-guard",
    code: createExample(
      `const result = await load(identifier, { signal: controller.signal }); if (controller.signal.aborted || !enabled) return; setValue(result);`,
    ),
    expectedTargetCount: 0,
  },
  {
    name: "preserve-native-throw-if-aborted",
    code: createExample(
      `const result = await load(identifier, { signal: controller.signal }); controller.signal.throwIfAborted(); setValue(result);`,
    ),
    expectedTargetCount: 0,
  },
  {
    name: "preserve-legacy-cancelled-with-uncertified-native",
    code: createExample(
      `const result = await load(identifier, { signal: controller.signal }); if (cancelled) return; setValue(result);`,
      {
        owner: `let cancelled = false; const controller = new AbortController(); controller.abort = () => {};`,
        cleanup: `return () => { cancelled = true; controller.abort(); };`,
      },
    ),
    expectedTargetCount: 0,
  },
  {
    name: "preserve-legacy-sequence-guard",
    code: createExample(
      `const result = await load(identifier, { signal: controller.signal }); if (request !== sequence) return; setValue(result);`,
      {
        owner: `const request = ++sequence; const controller = new AbortController();`,
        prefix: `let sequence = 0;`,
      },
    ),
    expectedTargetCount: 0,
  },
  {
    name: "retain-uncertain-readonly-signal-observer",
    code: createExample(
      `const result = await load(identifier, { signal: controller.signal }); setValue(result);`,
      {
        owner: `const controller = new AbortController(); const observed = controller.signal; void observed;`,
      },
    ),
    expectedTargetCount: 0,
  },
  {
    name: "retain-reentry-after-native-guard",
    code: createExample(
      `const result = await load(identifier, { signal: controller.signal }); if (controller.signal.aborted) return; afterGuard(); setValue(result);`,
    ),
    expectedTargetCount: 0,
  },
  {
    name: "retain-throwing-cleanup-before-abort",
    code: createExample(
      `const result = await load(identifier, { signal: controller.signal }); setValue(result);`,
      {
        cleanup: `return () => { afterGuard(); controller.abort(); };`,
      },
    ),
    expectedTargetCount: 0,
  },
  {
    name: "retain-async-cleanup-delays-abort",
    code: createExample(
      `const result = await load(identifier, { signal: controller.signal }); setValue(result);`,
      {
        cleanup: `return async () => { await afterGuard(); controller.abort(); };`,
      },
    ),
    expectedTargetCount: 0,
  },
  {
    name: "withdraw-with-abort-first-and-later-cleanup",
    code: createExample(
      `const result = await load(identifier, { signal: controller.signal }); setValue(result);`,
      {
        cleanup: `return () => { controller.abort(); afterGuard(); };`,
      },
    ),
    expectedTargetCount: 1,
  },
  {
    name: "retain-provider-alias-prototype-mutation",
    code: createExample(
      `const result = await load(identifier, { signal: controller.signal }); setValue(result);`,
      {
        prefix: `const NativeController = AbortController; NativeController.prototype.abort = () => {};`,
      },
    ),
    expectedTargetCount: 0,
  },
  {
    name: "retain-erased-eval-capability",
    code: createExample(
      `const result = await load(identifier, { signal: controller.signal }); setValue(result);`,
      {
        prefix: `interface eval {}
eval("AbortController.prototype.abort = () => {}");`,
      },
    ),
    expectedTargetCount: 0,
  },
  {
    name: "retain-emitted-ts-native-mutation",
    code: createExample(
      `const result = await load(identifier, { signal: controller.signal }); setValue(result);`,
      {
        prefix: `enum Patch { Applied = (AbortController.prototype.abort = () => {}, 0) }`,
      },
    ),
    expectedTargetCount: 0,
  },
  {
    name: "preserve-frozen-direct-native-guard",
    code: createExample(
      `const result = await load(identifier, { signal: controller.signal }); if (!controller.signal.aborted) setValue(result);`,
    ),
    expectedTargetCount: 0,
  },
  {
    name: "cleanup-aware-functional-updater-alias",
    code: `import { useEffect, useState } from "react";
export const Example = ({ load, resourceId }) => {
  const [value, setValue] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const guardedUpdate = previous => cancelled ? previous : 1;
    const run = async () => {
      await load(resourceId, { signal: controller.signal });
      setValue(guardedUpdate);
    };
    void run();
    return () => { controller.abort(); cancelled = true; };
  }, [load, resourceId]);
  return <output>{String(value)}</output>;
};`,
    expectedTargetCount: 0,
  },
  {
    name: "cleanup-aware-functional-updater-two-aliases",
    code: `import { useEffect, useState } from "react";
export const Example = ({ load, resourceId }) => {
  const [value, setValue] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const guardedUpdate = previous => cancelled ? previous : 1;
    const publish = guardedUpdate;
    const run = async () => {
      await load(resourceId, { signal: controller.signal });
      setValue(publish);
    };
    void run();
    return () => { controller.abort(); cancelled = true; };
  }, [load, resourceId]);
  return <output>{String(value)}</output>;
};`,
    expectedTargetCount: 0,
  },
  {
    name: "setter-argument-before-const-initialization",
    code: `import { useEffect, useState } from "react";
export const Example = ({ load, resourceId }) => {
  const [value, setValue] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    const run = async () => {
      await load(resourceId, { signal: controller.signal });
      setValue(result);
      const result = 1;
    };
    void run();
    return () => controller.abort();
  }, [load, resourceId]);
  return <output>{String(value)}</output>;
};`,
    expectedTargetCount: 0,
  },
  {
    name: "visible-react-state-provider-replacement",
    code: `import React, { useEffect } from "react";
React.useState = () => [null, () => {}];
export const Example = ({ load, resourceId }) => {
  const [value, setValue] = React.useState(null);
  useEffect(() => {
    const controller = new AbortController();
    const run = async () => {
      const result = await load(resourceId, { signal: controller.signal });
      setValue(result);
    };
    void run();
    return () => controller.abort();
  }, [load, resourceId]);
  return <output>{String(value)}</output>;
};`,
    expectedTargetCount: 0,
  },
  {
    name: "local-loader-returns-guarded-updater",
    code: `import { useEffect, useState } from "react";
export const LoaderPanel = ({ resourceId }) => {
  const [value, setValue] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const guarded = (previous) => cancelled ? previous : 1;
    const load = async (_signal) => guarded;
    const run = async () => {
      const result = await load(controller.signal);
      setValue(result);
    };
    void run();
    return () => { controller.abort(); cancelled = true; };
  }, [resourceId]);
  return <output>{String(value)}</output>;
};`,
    expectedTargetCount: 0,
  },
  {
    name: "rebound-state-dispatcher",
    code: `import { useEffect, useState } from "react";
export const ReboundDispatcher = ({ load, resourceId }) => {
  let [value, setValue] = useState(null);
  setValue = Number;
  useEffect(() => {
    const controller = new AbortController();
    const run = async () => {
      const result = await load(resourceId, { signal: controller.signal });
      setValue(result);
    };
    void run();
    return () => controller.abort();
  }, [load, resourceId]);
  return <output>{String(value)}</output>;
};`,
    expectedTargetCount: 0,
  },
];

describe("partial owned abort continuation protection", () => {
  it.each(cases)("$name", ({ code, expectedTargetCount }) => {
    const result = runRule(noSetStateAfterAwaitInEffect, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedTargetCount);
  });
});
