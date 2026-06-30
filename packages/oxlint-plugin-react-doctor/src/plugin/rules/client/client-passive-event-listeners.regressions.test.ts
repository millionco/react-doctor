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
}`
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
}`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
