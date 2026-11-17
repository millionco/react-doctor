import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const guardedAsyncEmitterSource = `
import { useEffect } from 'react';

declare const emitter: {
  on(event: string, listener: () => void): void;
  off(event: string, listener: () => void): void;
};
declare function ready(): Promise<void>;

export function AsyncSubscribe() {
  useEffect(() => {
    let cancelled = false;
    const listener = () => {};

    const subscribe = async () => {
      await ready();
      if (cancelled) return;
      emitter.on('change', listener);
    };
    void subscribe();

    return () => {
      cancelled = true;
      emitter.off('change', listener);
    };
  }, []);
  return null;
}
`;

describe("effect-needs-cleanup named async timer starters", () => {
  it.each([
    [
      "named async declaration",
      guardedAsyncEmitterSource.replace(
        "const subscribe = async () =>",
        "async function subscribe()",
      ),
      0,
    ],
    [
      "positive cancellation branch",
      guardedAsyncEmitterSource.replace(
        "if (cancelled) return;\n      emitter.on('change', listener);",
        "if (!cancelled) emitter.on('change', listener);",
      ),
      0,
    ],
    [
      "DOM listener pair",
      guardedAsyncEmitterSource
        .replaceAll("on(", "addEventListener(")
        .replaceAll("off(", "removeEventListener("),
      0,
    ],
    ["no cancellation", guardedAsyncEmitterSource.replace("if (cancelled) return;", ""), 1],
    [
      "cancellation checked before await",
      guardedAsyncEmitterSource.replace(
        "await ready();\n      if (cancelled) return;",
        "if (cancelled) return; await ready();",
      ),
      1,
    ],
    [
      "second suspension after guard",
      guardedAsyncEmitterSource.replace(
        "emitter.on('change', listener);",
        "await ready(); emitter.on('change', listener);",
      ),
      1,
    ],
    [
      "guard reset after check",
      guardedAsyncEmitterSource.replace(
        "emitter.on('change', listener);",
        "cancelled = false; emitter.on('change', listener);",
      ),
      1,
    ],
    [
      "stable receiver alias",
      guardedAsyncEmitterSource
        .replace("const listener =", "const target = emitter; const listener =")
        .replace("emitter.on", "target.on")
        .replace("emitter.off", "target.off"),
      0,
    ],
    [
      "stable event name",
      guardedAsyncEmitterSource
        .replace("const listener =", "const eventName = 'change'; const listener =")
        .replaceAll("('change', listener)", "(eventName, listener)"),
      0,
    ],
    [
      "reassigned event name",
      guardedAsyncEmitterSource
        .replace("const listener =", "let eventName = 'change'; const listener =")
        .replaceAll("('change', listener)", "(eventName, listener)")
        .replace("cancelled = true;", "cancelled = true; eventName = 'other';"),
      1,
    ],
    [
      "reassigned listener",
      guardedAsyncEmitterSource
        .replace("const listener", "let listener")
        .replace("cancelled = true;", "cancelled = true; listener = () => {};"),
      1,
    ],
    [
      "reassigned receiver",
      guardedAsyncEmitterSource
        .replace("const listener =", "let target = emitter; const listener =")
        .replace("emitter.on", "target.on")
        .replace("emitter.off", "target.off")
        .replace("cancelled = true;", "cancelled = true; target = otherEmitter;"),
      1,
    ],
    [
      "wrong listener",
      guardedAsyncEmitterSource.replace(
        "emitter.off('change', listener)",
        "emitter.off('change', () => {})",
      ),
      1,
    ],
    [
      "wrong event",
      guardedAsyncEmitterSource.replace(
        "emitter.off('change', listener)",
        "emitter.off('other', listener)",
      ),
      1,
    ],
    [
      "wrong receiver",
      guardedAsyncEmitterSource.replace(
        "emitter.off('change', listener)",
        "otherEmitter.off('change', listener)",
      ),
      1,
    ],
    [
      "conditional removal",
      guardedAsyncEmitterSource.replace(
        "emitter.off('change', listener);",
        "if (enabled) emitter.off('change', listener);",
      ),
      1,
    ],
    ["missing invalidation", guardedAsyncEmitterSource.replace("cancelled = true;", ""), 1],
    [
      "skipped cleanup return",
      guardedAsyncEmitterSource.replace("return () => {", "if (skip) return; return () => {"),
      1,
    ],
    [
      "shadowed cancellation",
      guardedAsyncEmitterSource.replace(
        "if (cancelled) return;",
        "const cancelled = false; if (cancelled) return;",
      ),
      1,
    ],
    [
      "repeated registration in a loop",
      guardedAsyncEmitterSource.replace(
        "emitter.on('change', listener);",
        "for (let index = 0; index < count; index++) emitter.on('change', listener);",
      ),
      1,
    ],
    [
      "multiple async invocations",
      guardedAsyncEmitterSource.replace("void subscribe();", "void subscribe(); void subscribe();"),
      1,
    ],
    [
      "escaped async helper",
      guardedAsyncEmitterSource.replace(
        "void subscribe();",
        "register(subscribe); void subscribe();",
      ),
      1,
    ],
    [
      "async cleanup",
      guardedAsyncEmitterSource.replace("return () => {", "return async () => {"),
      1,
    ],
  ])("checks guarded async listener %s", (_name, code, expected) => {
    const result = runRule(effectNeedsCleanup, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });

  it("accepts issue #2446 cleanup lifecycle", () => {
    const result = runRule(effectNeedsCleanup, guardedAsyncEmitterSource);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports a named async arrow that schedules a timer after an await without a lifecycle guard", () => {
    const result = runRule(
      effectNeedsCleanup,
      `
      import { useEffect, useState } from "react";

      const DelayedBanner = () => {
        const [isVisible, setIsVisible] = useState(false);
        useEffect(() => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const load = async () => {
            await fetch("/banner");
            timer = setTimeout(() => setIsVisible(true), 1000);
          };
          void load();
          return () => {
            clearTimeout(timer);
          };
        }, []);
        return isVisible ? <p>banner</p> : null;
      };
    `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("reports a named async function expression that schedules a timer after an await without a lifecycle guard", () => {
    const result = runRule(
      effectNeedsCleanup,
      `
      import { useEffect, useState } from "react";

      const DelayedBanner = () => {
        const [isVisible, setIsVisible] = useState(false);
        useEffect(() => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const load = async function () {
            await fetch("/banner");
            timer = setTimeout(() => setIsVisible(true), 1000);
          };
          load();
          return () => {
            clearTimeout(timer);
          };
        }, []);
        return isVisible ? <p>banner</p> : null;
      };
    `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("accepts a named async arrow that checks the lifecycle guard after the await", () => {
    const result = runRule(
      effectNeedsCleanup,
      `
      import { useEffect, useState } from "react";

      const DelayedBanner = () => {
        const [isVisible, setIsVisible] = useState(false);
        useEffect(() => {
          let isCancelled = false;
          let timer: ReturnType<typeof setTimeout> | undefined;
          const load = async () => {
            await fetch("/banner");
            if (isCancelled) return;
            timer = setTimeout(() => setIsVisible(true), 1000);
          };
          void load();
          return () => {
            isCancelled = true;
            clearTimeout(timer);
          };
        }, []);
        return isVisible ? <p>banner</p> : null;
      };
    `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a named async arrow that schedules its timer before the first await", () => {
    const result = runRule(
      effectNeedsCleanup,
      `
      import { useEffect, useState } from "react";

      const DelayedBanner = () => {
        const [isVisible, setIsVisible] = useState(false);
        useEffect(() => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const load = async () => {
            timer = setTimeout(() => setIsVisible(true), 1000);
            await fetch("/banner");
          };
          void load();
          return () => {
            clearTimeout(timer);
          };
        }, []);
        return isVisible ? <p>banner</p> : null;
      };
    `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports a guarded named async arrow that restarts itself from its timer", () => {
    const result = runRule(
      effectNeedsCleanup,
      `
      import { useEffect, useState } from "react";

      const PollStatus = () => {
        const [status, setStatus] = useState(0);
        useEffect(() => {
          let isCancelled = false;
          let timer: ReturnType<typeof setTimeout> | undefined;
          const poll = async () => {
            const response = await fetch("/status");
            if (isCancelled) return;
            setStatus(response.status);
            timer = setTimeout(() => void poll(), 1000);
          };
          void poll();
          return () => {
            isCancelled = true;
            clearTimeout(timer);
          };
        }, []);
        return <p>{status}</p>;
      };
    `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});

describe("effect-needs-cleanup named async timer guard boundaries", () => {
  it.each([
    "if (isCancelled) return; await fetch('/banner'); timer = setTimeout(show, 1000);",
    "await fetch('/banner'); if (isCancelled) return; await fetch('/details'); timer = setTimeout(show, 1000);",
    "await fetch('/banner'); if (isCancelled) return; timer = setTimeout(show, 1000);",
  ])("rejects an incomplete lifecycle guard: %s", (body) => {
    const result = runRule(
      effectNeedsCleanup,
      `
      import { useEffect } from "react";
      const Banner = () => {
        useEffect(() => {
          let isCancelled = false;
          let timer;
          const load = async () => { ${body} };
          void load();
          return () => { clearTimeout(timer); };
        }, []);
        return null;
      };
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects another suspension after an otherwise valid lifecycle guard", () => {
    const result = runRule(
      effectNeedsCleanup,
      `
      import { useEffect } from "react";
      const Banner = () => {
        useEffect(() => {
          let isCancelled = false;
          let timer;
          const load = async () => {
            await fetch('/banner');
            if (isCancelled) return;
            await fetch('/details');
            timer = setTimeout(show, 1000);
          };
          void load();
          return () => { isCancelled = true; clearTimeout(timer); };
        }, []);
        return null;
      };
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    "const load = async function loadBanner() { await fetch('/banner'); timer = setTimeout(show, 1000); };",
    "const load = async () => { await fetch('/banner'); timer = window.setTimeout(show, 1000); };",
  ])("reports post-suspension timer creation: %s", (declaration) => {
    const result = runRule(
      effectNeedsCleanup,
      `
      import { useEffect } from "react";
      const Banner = () => {
        useEffect(() => {
          let timer;
          ${declaration}
          void load();
          return () => { window.clearTimeout(timer); };
        }, []);
        return null;
      };
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
