import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { clientPassiveEventListeners } from "./client-passive-event-listeners.js";

const temporaryDirectories: string[] = [];

const writeImportedPredicate = (source: string): string => {
  const directory = mkdtempSync(join(tmpdir(), "react-doctor-passive-predicate-"));
  temporaryDirectories.push(directory);
  writeFileSync(join(directory, "events.ts"), source);
  return join(directory, "consumer.ts");
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

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

  it("still flags an assigned safe handler", () => {
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

  it("still flags an unresolved ref-style `.current` handler", () => {
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

  it("still flags an imported identifier handler", () => {
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

  it("stays silent when a function-declaration handler forwards the event", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `function setup(el: HTMLElement) {
  function onTouchMove(event) { doStuff(event); }
  el.addEventListener("touchmove", onTouchMove);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
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

  it("still flags an options object without a passive key for a proven-safe handler", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `function attach(el: HTMLElement) {
  el.addEventListener("wheel", () => trackPosition(), { capture: true });
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
        element.addEventListener("wheel", () => trackPosition());
        target?.addEventListener("touchmove", () => trackPosition());
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
      `window.addEventListener("wheel", () => trackPosition());
       document.addEventListener("touchmove", () => trackPosition());
       const found = document.querySelector("main");
       const firstAlias = found;
       const secondAlias = firstAlias;
       secondAlias?.addEventListener("wheel", () => trackPosition());`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("flags an un-reassigned let receiver with a proven DOM initializer", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `let el = document.createElement("div");
       el.addEventListener("wheel", handleWheel);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trust a reassigned let receiver with a proven DOM initializer", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `let el = document.createElement("div");
       el = getCustomTarget();
       el.addEventListener("wheel", handleWheel);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags global EventTarget constructions and constructor aliases", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `const Target = EventTarget;
       const first = new EventTarget();
       const second = new Target();
       first.addEventListener("wheel", () => trackPosition());
       second.addEventListener("touchmove", () => trackPosition());`,
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
       alias.current?.addEventListener("wheel", () => trackPosition());`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent after addEventListener is replaced", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `const target = new EventTarget();
       target.addEventListener = ((...args: unknown[]) => {}) as EventTarget["addEventListener"];
       target.addEventListener("wheel", () => trackPosition());`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("follows aliases when checking for addEventListener replacement", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `const target = new EventTarget();
       const alias = target;
       alias.addEventListener = ((...args: unknown[]) => {}) as EventTarget["addEventListener"];
       target.addEventListener("wheel", () => trackPosition());`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("follows EventTarget escapes through aliases and containers", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `const first = new EventTarget();
       const firstAlias = first;
       customize(firstAlias);
       first.addEventListener("wheel", () => trackPosition());

       const second = new EventTarget();
       customize({ second });
       second.addEventListener("wheel", () => trackPosition());

       const third = new EventTarget();
       const registry = {};
       registry.target = third;
       customize(registry);
       third.addEventListener("wheel", () => trackPosition());`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still reports when addEventListener is replaced only after registration", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `const target = new EventTarget();
       target.addEventListener("wheel", () => trackPosition());
       target.addEventListener = ((...args: unknown[]) => {}) as EventTarget["addEventListener"];`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags DOM type assertions and asserted initializers", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `(getTarget() as HTMLElement).addEventListener("wheel", () => trackPosition());
       const element = getTarget() satisfies Element;
       element.addEventListener("touchmove", () => trackPosition());`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not trust DOM assertions on mutable bindings, parameters, or members", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `let mutableTarget = customTarget;
       (mutableTarget as EventTarget).addEventListener("wheel", handleWheel);
       const attach = (target) => {
         (target as EventTarget).addEventListener("wheel", handleWheel);
       };
       (holder.target as EventTarget).addEventListener("wheel", handleWheel);`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not trust DOM assertions laundered through const aliases", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `const attach = (source) => {
         const target = source;
         (target as EventTarget).addEventListener("wheel", () => trackPosition());
       };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps constructed DOM receivers proven through asserted const aliases", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `const source = new EventTarget();
       const target = source;
       (target as EventTarget).addEventListener("wheel", () => trackPosition());`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps typed DOM parameters proven through redundant assertions", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `const attach = (target: EventTarget) => {
         (target as EventTarget).addEventListener("wheel", () => trackPosition());
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags destructured DOM target parameters", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `const attach = ({ element }: { element: HTMLElement }) => {
         element.addEventListener("wheel", () => trackPosition());
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags DOM class fields by initializer and annotation", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `class View {
         first = document.createElement("div");
         second: HTMLElement;
         attach() {
           this.first.addEventListener("wheel", () => trackPosition());
           this.second.addEventListener("touchmove", () => trackPosition());
         }
       }`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags same-file factories that return DOM targets", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `const createTarget = () => document.createElement("div");
       function makeTarget() { return createTarget(); }
       makeTarget().addEventListener("wheel", () => trackPosition());`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trust invented DOM-looking interface names", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `interface HTMLGestureElement {
         addEventListener(eventName: "wheel", handler: () => void, priority?: number): void;
       }
       const attach = (element: HTMLGestureElement) => {
         element.addEventListener("wheel", handleWheel);
       };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when an inline handler forwards the event", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `const target = new EventTarget();
       target.addEventListener("wheel", (event) => onMove(event));`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on generated archived documentation bundles", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `document.addEventListener("touchmove", this.handleMove);`,
      { filename: "/repo/packages/skin/docs/archive/v6.3/static/ds4/docs.js" },
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still reports the same code in authored source", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `document.addEventListener("touchmove", this.handleMove);`,
      { filename: "/repo/src/docs.js" },
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports authored source beside generated archived documentation", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `document.addEventListener("touchmove", () => trackPosition());`,
      { filename: "/repo/packages/skin/docs/archive/v6.3/static/ds4/authored-feature.ts" },
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("follows local handlers that forward the event to an unknown callback", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `const target = new EventTarget();
       const forwardEvent = (event: Event) => optionsRef.current?.onMove(event);
       const handleMove = (event: Event) => forwardEvent(event);
       target.addEventListener("touchmove", handleMove);`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("follows asserted aliases when a handler forwards the event", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `const target = new EventTarget();
       const handleMove = (event: Event) => {
         const touchEvent = event as TouchEvent;
         optionsRef.current?.onMove(touchEvent);
       };
       target.addEventListener("touchmove", handleMove);`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still reports when a handler forwards only an event property", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `const target = new EventTarget();
       target.addEventListener("wheel", (event: WheelEvent) => onMove(event.deltaY));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports when a handler only reads event properties", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `const target = new EventTarget();
       const handleMove = (event: TouchEvent) => {
         const touch = event.touches[0];
         updatePosition(touch.clientX, touch.clientY);
       };
       target.addEventListener("touchmove", handleMove);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not prove a mixed-return DOM factory", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `class GestureBus { addEventListener() {} }
       const makeTarget = (native: boolean) => native ? document.body : new GestureBus();
       makeTarget(false).addEventListener("wheel", () => trackPosition());`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("proves a factory only when every return is a DOM target", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `const makeTarget = (useBody: boolean) => useBody ? document.body : document.documentElement;
       makeTarget(false).addEventListener("wheel", () => trackPosition());`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("recognizes representative built-in HTML and SVG element types", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `const attach = (audio: HTMLAudioElement, circle: SVGCircleElement) => {
         audio.addEventListener("wheel", () => trackPosition());
         circle.addEventListener("touchmove", () => trackPosition());
       };`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("stays silent after a class receiver field is reassigned", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `class GestureBus { addEventListener() {} }
       class View {
         target = document.body;
         attach() {
           this.target = new GestureBus();
           this.target.addEventListener("wheel", () => trackPosition());
         }
       }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still reports when a class receiver field is reassigned only after registration", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `class GestureBus { addEventListener() {} }
       class View {
         target = document.body;
         attach() {
           this.target.addEventListener("wheel", () => trackPosition());
           this.target = new GestureBus();
         }
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not bind nested ordinary-function this to the outer class", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `class View {
         target = document.body;
         attach() {
           function register() {
             this.target.addEventListener("wheel", () => trackPosition());
           }
           register.call({ target: new EventTarget() });
         }
       }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still binds arrow-function this to the outer class", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `class View {
         target = document.body;
         attach() {
           const register = () => this.target.addEventListener("wheel", () => trackPosition());
           register();
         }
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when a method is replaced before a declared function runs", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `const target = new EventTarget();
       function attach() {
         target.addEventListener("wheel", () => trackPosition());
       }
       target.addEventListener = customListener;
       attach();`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still reports after a non-dominating conditional method replacement", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `const target = new EventTarget();
       if (replaceListener) target.addEventListener = customListener;
       target.addEventListener("wheel", () => trackPosition());`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent after EventTarget prototype replacement", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `EventTarget.prototype.addEventListener = customListener;
       const target = new EventTarget();
       target.addEventListener("wheel", () => trackPosition());`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("follows event escape through synchronous nested callbacks", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `const target = new EventTarget();
       target.addEventListener("wheel", (event) => {
         (() => onMove(event))();
         [onMove].forEach((callback) => callback(event));
       });`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores event escape through a deferred callback", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `const target = new EventTarget();
       target.addEventListener("wheel", (event) => {
         requestAnimationFrame(() => onMove(event));
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("tracks separate parameter indexes for the same helper", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `const forward = (first: unknown, second: Event) => onMove(second);
       const target = new EventTarget();
       target.addEventListener("wheel", (event) => {
         forward(event, 0);
         forward(0, event);
       });`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("detects wrapped, spread, and assignment-based event escape", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `const first = new EventTarget();
       first.addEventListener("wheel", (event) => onMove({ event }));
       const second = new EventTarget();
       second.addEventListener("wheel", (event) => onMove([event]));
       const third = new EventTarget();
       third.addEventListener("wheel", (event) => onMove(...[event]));
       const fourth = new EventTarget();
       fourth.addEventListener("wheel", (event) => {
         let alias;
         alias = event;
         onMove(alias);
       });`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("conservatively follows wrapped events into destructured helper parameters", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `const forward = ({ event }: { event: Event }) => onMove(event);
       const target = new EventTarget();
       target.addEventListener("wheel", (event) => forward({ event }));`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still reports a root handler that only destructures event properties", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `const target = new EventTarget();
       target.addEventListener("wheel", ({ target }) => track(target));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("resolves an assigned safe handler", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `let handler;
       handler = (event: WheelEvent) => track(event.deltaY);
       const target = new EventTarget();
       target.addEventListener("wheel", handler);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports when a proven-pure imported predicate only classifies the event", () => {
    const filename = writeImportedPredicate(
      `export const isTouchEvent = (event: Event): boolean => "touches" in event;`,
    );
    const result = runRule(
      clientPassiveEventListeners,
      `import { isTouchEvent } from "./events";
       const target = new EventTarget();
       target.addEventListener("touchmove", (event) => {
         const point = isTouchEvent(event) ? event.touches[0] : event;
         track(point.clientX);
       });`,
      { filename },
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports when an imported predicate passes only a derived scalar", () => {
    const filename = writeImportedPredicate(
      `export const isWheelEvent = (event: Event): boolean => Boolean(event.type);`,
    );
    const result = runRule(
      clientPassiveEventListeners,
      `import { isWheelEvent } from "./events";
       const target = new EventTarget();
       target.addEventListener("wheel", (event) => {
         if (isWheelEvent(event)) track();
       });`,
      { filename },
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when an imported predicate can cancel the event", () => {
    const filename = writeImportedPredicate(
      `export const isTouchEvent = (event: Event): boolean => {
         event.preventDefault();
         return true;
       };`,
    );
    const result = runRule(
      clientPassiveEventListeners,
      `import { isTouchEvent } from "./events";
       const target = new EventTarget();
       target.addEventListener("touchmove", (event) => {
         if (isTouchEvent(event)) track();
       });`,
      { filename },
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when an imported predicate cancels through aliases", () => {
    const filename = writeImportedPredicate(
      `export const isTouchEvent = (event: Event): boolean => {
         const first = event;
         const second = first;
         second.preventDefault();
         return true;
       };`,
    );
    const result = runRule(
      clientPassiveEventListeners,
      `import { isTouchEvent } from "./events";
       const target = new EventTarget();
       target.addEventListener("touchmove", (event) => {
         if (isTouchEvent(event)) track();
       });`,
      { filename },
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when an imported predicate cancels inside a synchronous callback", () => {
    const filename = writeImportedPredicate(
      `export const isTouchEvent = (event: Event): boolean => {
         [1].forEach(() => event.preventDefault());
         return true;
       };`,
    );
    const result = runRule(
      clientPassiveEventListeners,
      `import { isTouchEvent } from "./events";
       const target = new EventTarget();
       target.addEventListener("touchmove", (event) => {
         if (isTouchEvent(event)) track();
       });`,
      { filename },
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when an imported predicate cancels inside an IIFE", () => {
    const filename = writeImportedPredicate(
      `export const isTouchEvent = (event: Event): boolean => {
         (() => {
           event.preventDefault();
         })();
         return true;
       };`,
    );
    const result = runRule(
      clientPassiveEventListeners,
      `import { isTouchEvent } from "./events";
       const target = new EventTarget();
       target.addEventListener("touchmove", (event) => {
         if (isTouchEvent(event)) track();
       });`,
      { filename },
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still reports when an imported predicate only runs event-free nested callbacks", () => {
    const filename = writeImportedPredicate(
      `export const isTouchEvent = (event: Event): boolean => {
         ["touchstart", "touchmove"].forEach((eventName) => registerSeenEvent(eventName));
         return "touches" in event;
       };`,
    );
    const result = runRule(
      clientPassiveEventListeners,
      `import { isTouchEvent } from "./events";
       const target = new EventTarget();
       target.addEventListener("touchmove", (event) => {
         if (isTouchEvent(event)) track();
       });`,
      { filename },
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when an imported callable consumes the event", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `import { onMove } from "./events";
       const target = new EventTarget();
       target.addEventListener("touchmove", (event) => onMove(event));`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on computed and helper-mediated cancellation", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `const cancel = (event: Event) => event["preventDefault"]();
       const forward = (event: Event) => cancel(event);
       const target = new EventTarget();
       target.addEventListener("wheel", (event) => forward(event));`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("recognizes legacy returnValue cancellation", () => {
    const cancelling = runRule(
      clientPassiveEventListeners,
      `const target = new EventTarget();
       target.addEventListener("wheel", (event) => { event.returnValue = false; });`,
    );
    const nonCancelling = runRule(
      clientPassiveEventListeners,
      `const target = new EventTarget();
       target.addEventListener("wheel", (event) => { event.returnValue = true; });`,
    );
    expect(cancelling.diagnostics).toEqual([]);
    expect(nonCancelling.diagnostics).toHaveLength(1);
  });

  it("does not trust a shadowed deferred callback name", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `const setTimeout = (callback: () => void) => callback();
       const target = new EventTarget();
       target.addEventListener("wheel", (event) => setTimeout(() => onMove(event)));`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("recognizes callbacks deferred by proven Promise receivers", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `const target = new EventTarget();
       target.addEventListener("wheel", (event) => {
         Promise.resolve().then(() => onMove(event));
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("recognizes callbacks deferred by aliased and chained proven Promises", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `const target = new EventTarget();
       const pending = Promise.resolve();
       target.addEventListener("wheel", (event) => {
         pending.then(() => true).then(() => onMove(event));
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("recognizes callbacks registered on proven EventTarget receivers", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `const target = new EventTarget();
       target.addEventListener("wheel", (event) => {
         window.addEventListener("click", () => onMove(event));
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("invalidates an assigned handler after an opaque reassignment", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `import { external } from "./events";
       let handler;
       handler = (event: WheelEvent) => track(event.deltaY);
       if (condition) handler = external;
       const target = new EventTarget();
       target.addEventListener("wheel", handler);`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not prove reassigned EventTarget factories", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `let make = () => new EventTarget();
       make = () => custom;
       make().addEventListener("wheel", () => track());`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("recognizes EventTarget mutations on factory return values", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `const make = () => {
         const target = new EventTarget();
         target.addEventListener = customListener;
         return target;
       };
       make().addEventListener("wheel", () => track());`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("tracks event aliases introduced by object and array destructuring", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `const target = new EventTarget();
       target.addEventListener("wheel", (event) => {
         const { value: firstAlias } = { value: event };
         const [secondAlias] = [firstAlias];
         onMove(secondAlias);
       });`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("distinguishes synchronous Promise executors from deferred Promise callbacks", () => {
    const synchronous = runRule(
      clientPassiveEventListeners,
      `const target = new EventTarget();
       target.addEventListener("wheel", (event) => {
         new Promise(() => onMove(event));
       });`,
    );
    const deferred = runRule(
      clientPassiveEventListeners,
      `const later = async () => {};
       const alias = later;
       const target = new EventTarget();
       target.addEventListener("wheel", (event) => {
         alias().then(() => onMove(event));
         Promise.reject().catch(() => onMove(event));
         Promise.resolve().finally(() => onMove(event));
       });`,
    );
    expect(synchronous.diagnostics).toEqual([]);
    expect(deferred.diagnostics).toHaveLength(1);
  });

  it("recognizes aliased proven deferred callback APIs", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `const defer = requestAnimationFrame;
       const target = new EventTarget();
       target.addEventListener("wheel", (event) => defer(() => onMove(event)));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("audits the imported predicate parameter that receives the event", () => {
    const filename = writeImportedPredicate(
      `export const isWheelEvent = (mode: string, event: Event): boolean => {
         event.preventDefault();
         return mode === "wheel";
       };`,
    );
    const result = runRule(
      clientPassiveEventListeners,
      `import { isWheelEvent } from "./events";
       const target = new EventTarget();
       target.addEventListener("wheel", (event) => {
         if (isWheelEvent("wheel", event)) track();
       });`,
      { filename },
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("recognizes EventTarget mutations across branches and constructors", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `const first = new EventTarget();
       if (condition) first.addEventListener = firstListener;
       else first.addEventListener = secondListener;
       first.addEventListener("wheel", () => track());

       class View {
         target = new EventTarget();
         constructor() { this.target.addEventListener = customListener; }
         run() { this.target.addEventListener("wheel", () => track()); }
       }
       new View().run();`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("recognizes specific and reflected EventTarget prototype replacement", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `Window.prototype.addEventListener = customListener;
       window.addEventListener("wheel", () => track());
       Document.prototype.addEventListener = customListener;
       document.addEventListener("wheel", () => track());
       HTMLElement.prototype.addEventListener = customListener;
       document.body.addEventListener("wheel", () => track());
       Reflect.defineProperty(EventTarget.prototype, "addEventListener", {
         value: customListener,
       });
       new EventTarget().addEventListener("wheel", () => track());`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("retains findings after proven native EventTarget replacement", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `let first: EventTarget = new EventTarget();
       first = first;
       first.addEventListener("wheel", () => track());
       let second: EventTarget = new EventTarget();
       second = new EventTarget();
       second.addEventListener("wheel", () => track());`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("recognizes typed DOM receiver prototype replacement", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `HTMLElement.prototype.addEventListener = customListener;
       const attach = (target: HTMLElement) => {
         target.addEventListener("wheel", () => track());
       };
       Element.prototype.addEventListener = customListener;
       document.querySelector("main")?.addEventListener("wheel", () => track());`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("tracks rest aliases and inline wrapper extraction", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `const target = new EventTarget();
       target.addEventListener("wheel", (event) => {
         const { ...box } = { event };
         const [...items] = [event];
         onMove(box.event);
         onMove(items[0]);
         onMove(({ value: event }).value);
         onMove([event][0]);
       });`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("treats event constructor arguments as synchronous exposure", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `new EventTarget().addEventListener("wheel", (event) => {
         new Handler(event);
       });`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("tracks destructured aliases in imported predicates", () => {
    const filename = writeImportedPredicate(
      `export const isWheelEvent = (event: Event): boolean => {
         const { value: firstAlias } = { value: event };
         const [secondAlias] = [firstAlias];
         secondAlias.preventDefault();
         return true;
       };`,
    );
    const result = runRule(
      clientPassiveEventListeners,
      `import { isWheelEvent } from "./events";
       new EventTarget().addEventListener("wheel", (event) => {
         if (isWheelEvent(event)) track();
       });`,
      { filename },
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("follows EventTarget escapes through object spreads", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `const target = new EventTarget();
       const box = { ...target };
       customize(box);
       target.addEventListener("wheel", () => track());`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("tracks constructor exposure inside synchronous nested callbacks", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `new EventTarget().addEventListener("wheel", (event) => {
         runNow(() => new Handler(event));
       });`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects imported predicates that pass events to constructors", () => {
    const filename = writeImportedPredicate(
      `export const isWheelEvent = (event: Event): boolean => {
         new Handler(event);
         return true;
       };`,
    );
    const result = runRule(
      clientPassiveEventListeners,
      `import { isWheelEvent } from "./events";
       new EventTarget().addEventListener("wheel", (event) => {
         if (isWheelEvent(event)) track();
       });`,
      { filename },
    );
    expect(result.diagnostics).toEqual([]);
  });
});
