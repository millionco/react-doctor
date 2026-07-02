import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectRemoveListenerInlineHandler } from "./effect-remove-listener-inline-handler.js";

describe("effect-remove-listener-inline-handler", () => {
  it("flags removeEventListener with an inline arrow handler", () => {
    const result = runRule(
      effectRemoveListenerInlineHandler,
      `el.removeEventListener('scroll', () => handle());`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags removeEventListener with an inline function expression", () => {
    const result = runRule(
      effectRemoveListenerInlineHandler,
      `window.removeEventListener('resize', function () { onResize(); });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags removeEventListener with a .bind() handler", () => {
    const result = runRule(
      effectRemoveListenerInlineHandler,
      `node.removeEventListener('click', this.handle.bind(this));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags emitter.off with an inline arrow handler", () => {
    const result = runRule(
      effectRemoveListenerInlineHandler,
      `emitter.off('data', (d) => process(d));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag two-arg unsubscribe since the second arg may be a completion callback", () => {
    const result = runRule(
      effectRemoveListenerInlineHandler,
      `appEvent.unsubscribe('update', (e) => handle(e));`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag mqtt-style unsubscribe with an inline ack callback", () => {
    const result = runRule(
      effectRemoveListenerInlineHandler,
      `client.unsubscribe('presence/room', (err) => { if (err) console.error(err); });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag removeEventListener with a stable identifier handler", () => {
    const result = runRule(
      effectRemoveListenerInlineHandler,
      `window.removeEventListener('resize', onResize);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag removeEventListener with a member-expression handler", () => {
    const result = runRule(
      effectRemoveListenerInlineHandler,
      `el.removeEventListener('scroll', handlerRef.current);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag addEventListener with an inline arrow handler", () => {
    const result = runRule(
      effectRemoveListenerInlineHandler,
      `window.addEventListener('resize', () => onResize(), { once: true });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag removeEventListener with a factory call result", () => {
    const result = runRule(
      effectRemoveListenerInlineHandler,
      `el.removeEventListener('scroll', makeHandler());`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a single-arg unsubscribe idiom", () => {
    const result = runRule(effectRemoveListenerInlineHandler, `store.unsubscribe(() => sync());`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag computed removal member access", () => {
    const result = runRule(
      effectRemoveListenerInlineHandler,
      `el[removeName]('scroll', () => handle());`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
