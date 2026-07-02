import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { clientPassiveEventListeners } from "./client-passive-event-listeners.js";

describe("client/client-passive-event-listeners — regressions", () => {
  it("still flags the inline rAF-throttled scroll handler (planted-bug anchor)", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `let ticking = false;
const onDocumentScroll = (callback) => {
  document.addEventListener('scroll', (evt) => {
    if (!ticking) {
      window.requestAnimationFrame(() => {
        callbacks.forEach((cbObj) => cbObj.cb._execute(evt));
        ticking = false;
      });
      ticking = true;
    }
  });
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on a referenced handler that calls preventDefault", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `function setup(el) {
  const onTouchMove = (event) => { event.preventDefault(); doSomething(); };
  el.addEventListener("touchmove", onTouchMove);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a referenced handler with no preventDefault", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `function setup(el) {
  const onScroll = () => { trackPosition(); };
  el.addEventListener("scroll", onScroll);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on a let-declared handler assigned preventDefault after declaration", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `function setup(el) {
  let onTouchMove;
  onTouchMove = (event) => { event.preventDefault(); };
  el.addEventListener("touchmove", onTouchMove);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a let-declared handler whose later assignment has no preventDefault", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `function setup(el) {
  let onScroll;
  onScroll = () => { trackPosition(); };
  el.addEventListener("scroll", onScroll);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags an outer scroll handler when only a nested callback calls preventDefault", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `function setup(el) {
  el.addEventListener("scroll", () => {
    updateHeader();
    attachDragGuard((dragEvent) => dragEvent.preventDefault());
  });
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on a `this.method` handler that calls preventDefault", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `class GestureSurface {
  handleMove(event) { event.preventDefault(); }
  attach(el) { el.addEventListener("touchmove", this.handleMove); }
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a `this.method` handler that does not call preventDefault", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `class Tracker {
  onScroll() { this.record(); }
  attach(el) { el.addEventListener("scroll", this.onScroll); }
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on a `this.#privateMethod` handler that calls preventDefault", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `class GestureSurface {
  #handleMove(event) { event.preventDefault(); }
  attach(el) { el.addEventListener("touchmove", this.#handleMove); }
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a `this.#privateMethod` handler that does not call preventDefault", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `class Tracker {
  #onScroll() { this.record(); }
  attach(el) { el.addEventListener("scroll", this.#onScroll); }
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on a `this.method` object-literal handler that calls preventDefault", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `const controller = {
  onTouchMove(event) { event.preventDefault(); },
  attach(el) { el.addEventListener("touchmove", this.onTouchMove); },
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a `this.method` object-literal handler that does not call preventDefault", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `const controller = {
  onScroll() { this.record(); },
  attach(el) { el.addEventListener("scroll", this.onScroll); },
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags an unresolved member handler from a parameter (flag unless proven unsafe)", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `function attach(el, handlers) {
  el.addEventListener("scroll", handlers.onScroll);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a ref-style `.current` handler with no passive option", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `function useAttach(el) {
  const handlerRef = useRef(() => trackPosition());
  el.addEventListener("scroll", handlerRef.current);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags an imported identifier handler (symmetric with member handlers)", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `import { onScroll } from "./handlers";
function attach(el) {
  el.addEventListener("scroll", onScroll);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on a function-declaration handler that calls preventDefault", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `function setup(el) {
  function onTouchMove(event) { event.preventDefault(); }
  el.addEventListener("touchmove", onTouchMove);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a function-declaration handler with no preventDefault", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `function setup(el) {
  function onTouchMove(event) { doStuff(event); }
  el.addEventListener("touchmove", onTouchMove);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on an explicit { passive: false } opt-out", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `function attach(el) {
  el.addEventListener("touchmove", (event) => track(event), { passive: false });
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on an explicit { passive: true }", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `function attach(el) {
  el.addEventListener("scroll", (event) => track(event), { passive: true });
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an options object without a passive key", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `function attach(el) {
  el.addEventListener("scroll", (event) => track(event), { capture: true });
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
