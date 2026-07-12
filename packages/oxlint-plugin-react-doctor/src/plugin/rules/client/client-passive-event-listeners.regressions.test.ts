import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { clientPassiveEventListeners } from "./client-passive-event-listeners.js";

describe("client/client-passive-event-listeners — regressions", () => {
  it("still flags the inline rAF-throttled wheel handler", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `let ticking = false;
const onDocumentWheel = (callback) => {
  document.addEventListener('wheel', (evt) => {
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
      `function setup(el: HTMLElement) {
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
      `function setup(el: HTMLElement) {
  const onWheel = () => { trackPosition(); };
  el.addEventListener("wheel", onWheel);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on a let-declared handler assigned preventDefault after declaration", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `function setup(el: HTMLElement) {
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
      `function setup(el: HTMLElement) {
  let onWheel;
  onWheel = () => { trackPosition(); };
  el.addEventListener("wheel", onWheel);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags an outer touchmove handler when only a nested callback calls preventDefault", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `function setup(el: HTMLElement) {
  el.addEventListener("touchmove", () => {
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
  attach(el: HTMLElement) { el.addEventListener("touchmove", this.handleMove); }
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a `this.method` handler that does not call preventDefault", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `class Tracker {
  onWheel() { this.record(); }
  attach(el: HTMLElement) { el.addEventListener("wheel", this.onWheel); }
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
  attach(el: HTMLElement) { el.addEventListener("touchmove", this.#handleMove); }
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a `this.#privateMethod` handler that does not call preventDefault", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `class Tracker {
  #onWheel() { this.record(); }
  attach(el: HTMLElement) { el.addEventListener("wheel", this.#onWheel); }
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
  attach(el: HTMLElement) { el.addEventListener("touchmove", this.onTouchMove); },
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a `this.method` object-literal handler that does not call preventDefault", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `const controller = {
  onWheel() { this.record(); },
  attach(el: HTMLElement) { el.addEventListener("wheel", this.onWheel); },
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags an unresolved member handler on a typed DOM target", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `function attach(el: HTMLElement, handlers) {
  el.addEventListener("wheel", handlers.onWheel);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a ref-style `.current` handler with no passive option", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `function useAttach(el: HTMLElement) {
  const handlerRef = useRef(() => trackPosition());
  el.addEventListener("wheel", handlerRef.current);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags an imported identifier handler (symmetric with member handlers)", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `import { onWheel } from "./handlers";
function attach(el: HTMLElement) {
  el.addEventListener("wheel", onWheel);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on a function-declaration handler that calls preventDefault", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `function setup(el: HTMLElement) {
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
      `function setup(el: HTMLElement) {
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
      `function attach(el: HTMLElement) {
  el.addEventListener("touchmove", (event) => track(event), { passive: false });
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on an explicit { passive: true }", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `function attach(el: HTMLElement) {
  el.addEventListener("wheel", (event) => track(event), { passive: true });
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an options object without a passive key", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `function attach(el: HTMLElement) {
  el.addEventListener("wheel", (event) => track(event), { capture: true });
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on a scroll listener (scroll is not cancelable, passive is a no-op)", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `function attach(el: HTMLElement) {
  el.addEventListener("scroll", () => updateHeader());
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a touchend listener (touchend does not block scroll starts)", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `function attach(el: HTMLElement) {
  el.addEventListener("touchend", (event) => finishGesture(event));
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a document scroll listener even without options", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `document.addEventListener("scroll", () => reportScrollDepth());`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on an unrelated typed event bus", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `interface GestureBus {
        addEventListener(eventName: "wheel", handler: (delta: number) => void, priority?: number): void;
      }
      const subscribe = (gestureBus: GestureBus) => {
        gestureBus.addEventListener("wheel", (delta) => track(delta));
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on an unresolved receiver", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `const subscribe = (target) => target.addEventListener("wheel", handleWheel);`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("flags typed DOM targets and nullable unions", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `const subscribe = (element: HTMLElement, target: EventTarget | null) => {
        element.addEventListener("wheel", handleWheel);
        target?.addEventListener("touchmove", handleTouchMove);
      };`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not trust a shadowed DOM type name", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `interface HTMLElement {
        addEventListener(eventName: "wheel", handler: () => void, priority?: number): void;
      }
      const subscribe = (element: HTMLElement) => {
        element.addEventListener("wheel", handleWheel);
      };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("flags global DOM targets and DOM acquisition aliases", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `window.addEventListener("wheel", handleWheel);
       document.addEventListener("touchmove", handleTouchMove);
       const found = document.querySelector("main");
       const firstAlias = found;
       const secondAlias = firstAlias;
       secondAlias?.addEventListener("wheel", handleWheel);`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("flags global EventTarget constructions and constructor aliases", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `const Target = EventTarget;
       const first = new EventTarget();
       const second = new Target();
       first.addEventListener("wheel", handleWheel);
       second.addEventListener("touchmove", handleTouchMove);`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not trust a shadowed EventTarget constructor", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `class EventTarget {
        addEventListener(eventName: string, handler: () => void, priority?: number) {}
      }
      new EventTarget().addEventListener("wheel", handleWheel);`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("flags typed React ref targets through aliases", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `import { useRef } from "react";
       const elementRef = useRef<HTMLDivElement | null>(null);
       const alias = elementRef;
       alias.current?.addEventListener("wheel", handleWheel);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
