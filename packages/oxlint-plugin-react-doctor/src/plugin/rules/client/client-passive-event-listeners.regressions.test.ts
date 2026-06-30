import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { clientPassiveEventListeners } from "./client-passive-event-listeners.js";

describe("client/client-passive-event-listeners — regressions", () => {
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

  it("stays silent on an unresolved member handler (conservative)", () => {
    const result = runRule(
      clientPassiveEventListeners,
      `function setup(el, controller) {
  el.addEventListener("touchmove", controller.onMove);
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
});
