import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectListenerCleanupReferenceMismatch } from "./effect-listener-cleanup-reference-mismatch.js";

describe("effect-listener-cleanup-reference-mismatch", () => {
  it("defers removeEventListener to effect-remove-listener-inline-handler", () => {
    const result = runRule(
      effectListenerCleanupReferenceMismatch,
      `
      useEffect(() => {
        window.addEventListener('beforeunload', () => save(token));
        return () => {
          window.removeEventListener('beforeunload', () => save(token));
        };
      }, [token]);
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("defers function-expression removeEventListener to the broader rule", () => {
    const result = runRule(
      effectListenerCleanupReferenceMismatch,
      `
      useEffect(() => {
        el.addEventListener('scroll', function () { onScroll(); });
        return () => el.removeEventListener('scroll', function () { onScroll(); });
      }, []);
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("defers EventEmitter off to the broader rule", () => {
    const result = runRule(
      effectListenerCleanupReferenceMismatch,
      `
      useEffect(() => {
        emitter.on('update', (d) => setData(d));
        return () => emitter.off('update', (d) => setData(d));
      }, []);
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags subscribe/unsubscribe with handler-only literals", () => {
    const result = runRule(
      effectListenerCleanupReferenceMismatch,
      `
      useEffect(() => {
        appEvent.subscribe((e) => handle(e));
        return () => appEvent.unsubscribe((e) => handle(e));
      }, []);
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("defers textually-identical removeEventListener literals to the broader rule", () => {
    const result = runRule(
      effectListenerCleanupReferenceMismatch,
      `
      useEffect(() => {
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
        return () => document.removeEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
      }, [close]);
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the same named handler on both sides", () => {
    const result = runRule(
      effectListenerCleanupReferenceMismatch,
      `
      const onUnload = () => save(token);
      useEffect(() => {
        window.addEventListener('beforeunload', onUnload);
        return () => window.removeEventListener('beforeunload', onUnload);
      }, [token]);
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a hoisted local binding used on both sides", () => {
    const result = runRule(
      effectListenerCleanupReferenceMismatch,
      `
      useEffect(() => {
        const handler = (e) => onScroll(e);
        el.addEventListener('scroll', handler);
        return () => el.removeEventListener('scroll', handler);
      }, []);
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an AbortController teardown with no remove call", () => {
    const result = runRule(
      effectListenerCleanupReferenceMismatch,
      `
      useEffect(() => {
        const controller = new AbortController();
        el.addEventListener('resize', () => onResize(), { signal: controller.signal });
        return () => controller.abort();
      }, []);
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an effect that never calls remove", () => {
    const result = runRule(
      effectListenerCleanupReferenceMismatch,
      `
      useEffect(() => {
        window.addEventListener('online', () => sync());
        return () => {};
      }, []);
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag different event strings", () => {
    const result = runRule(
      effectListenerCleanupReferenceMismatch,
      `
      useEffect(() => {
        window.addEventListener('resize', () => onResize());
        return () => window.removeEventListener('online', () => sync());
      }, []);
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag different targets with identical event and literal shape", () => {
    const result = runRule(
      effectListenerCleanupReferenceMismatch,
      `
      useEffect(() => {
        a.addEventListener('x', () => f());
        return () => b.removeEventListener('x', () => f());
      }, []);
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("defers the legacy MediaQueryList removeListener form to the broader rule", () => {
    const result = runRule(
      effectListenerCleanupReferenceMismatch,
      `
      useEffect(() => {
        const mql = window.matchMedia('(min-width: 600px)');
        mql.addListener((e) => setMatches(e.matches));
        return () => mql.removeListener((e) => setMatches(e.matches));
      }, []);
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("defers identifier-event removeEventListener calls to the broader rule", () => {
    const result = runRule(
      effectListenerCleanupReferenceMismatch,
      `
      const RESIZE = 'resize';
      useEffect(() => {
        window.addEventListener(RESIZE, () => onResize());
        return () => window.removeEventListener(RESIZE, () => onResize());
      }, []);
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("defers enum-event off calls to the broader rule", () => {
    const result = runRule(
      effectListenerCleanupReferenceMismatch,
      `
      useEffect(() => {
        emitter.on(EVENTS.UPDATE, (d) => setData(d));
        return () => emitter.off(EVENTS.UPDATE, (d) => setData(d));
      }, []);
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("defers template-event removeEventListener calls to the broader rule", () => {
    const result = runRule(
      effectListenerCleanupReferenceMismatch,
      `
      useEffect(() => {
        window.addEventListener(\`resize\`, () => onResize());
        return () => window.removeEventListener(\`resize\`, () => onResize());
      }, []);
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the MediaQueryList handler-only form with one shared named handler", () => {
    const result = runRule(
      effectListenerCleanupReferenceMismatch,
      `
      useEffect(() => {
        const mql = window.matchMedia('(min-width: 600px)');
        const onChange = (e) => setMatches(e.matches);
        mql.addListener(onChange);
        return () => mql.removeListener(onChange);
      }, []);
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a handler-only removal paired with an event-form registration", () => {
    const result = runRule(
      effectListenerCleanupReferenceMismatch,
      `
      useEffect(() => {
        mql.addListener('change', (e) => setMatches(e.matches));
        return () => mql.removeListener((e) => setMatches(e.matches));
      }, []);
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag different identifier event names on each side", () => {
    const result = runRule(
      effectListenerCleanupReferenceMismatch,
      `
      const RESIZE = 'resize';
      const ONLINE = 'online';
      useEffect(() => {
        window.addEventListener(RESIZE, () => onResize());
        return () => window.removeEventListener(ONLINE, () => sync());
      }, []);
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag computed event name expressions it cannot compare", () => {
    const result = runRule(
      effectListenerCleanupReferenceMismatch,
      `
      useEffect(() => {
        window.addEventListener(events[index], () => f());
        return () => window.removeEventListener(events[index], () => f());
      }, []);
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("matches static computed listener method names", () => {
    const mismatch = runRule(
      effectListenerCleanupReferenceMismatch,
      `useEffect(() => {
         source["subscribe"](() => onValue());
         return () => source[\`unsubscribe\`](() => onValue());
       }, []);`,
    );
    const matchingReference = runRule(
      effectListenerCleanupReferenceMismatch,
      `useEffect(() => {
         const onValue = () => update();
         source["subscribe"](onValue);
         return () => source[\`unsubscribe\`](onValue);
       }, []);`,
    );
    const wrongReceiver = runRule(
      effectListenerCleanupReferenceMismatch,
      `useEffect(() => {
         source["subscribe"](() => onValue());
         return () => other[\`unsubscribe\`](() => onValue());
       }, []);`,
    );
    expect(mismatch.diagnostics).toHaveLength(1);
    expect(matchingReference.diagnostics).toHaveLength(0);
    expect(wrongReceiver.diagnostics).toHaveLength(0);
  });

  it("follows synchronously invoked registration helpers", () => {
    const result = runRule(
      effectListenerCleanupReferenceMismatch,
      `useEffect(() => {
         const setup = () => store.subscribe(() => render());
         setup();
         return () => store.unsubscribe(() => render());
       }, [store]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
