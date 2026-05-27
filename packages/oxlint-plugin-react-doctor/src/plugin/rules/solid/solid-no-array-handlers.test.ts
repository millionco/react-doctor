import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { solidNoArrayHandlers } from "./solid-no-array-handlers.js";

describe("solid-no-array-handlers", () => {
  it("flags onClick with array expression", () => {
    const result = runRule(solidNoArrayHandlers, `<button onClick={[handler, data]} />`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("type-unsafe");
  });

  it("allows onClick with arrow function", () => {
    const result = runRule(solidNoArrayHandlers, `<button onClick={() => doSomething()} />`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows onClick with identifier reference", () => {
    const result = runRule(solidNoArrayHandlers, `<button onClick={handleClick} />`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags onInput with array expression", () => {
    const result = runRule(solidNoArrayHandlers, `<input onInput={[handleInput, value]} />`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag custom component elements", () => {
    const result = runRule(solidNoArrayHandlers, `<MyComponent onClick={[handler, data]} />`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag non-event attributes with arrays", () => {
    const result = runRule(solidNoArrayHandlers, `<div data-items={[1, 2, 3]} />`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags multiple array handlers on the same element", () => {
    const result = runRule(
      solidNoArrayHandlers,
      `<button onClick={[handler, data]} onMouseDown={[other, arg]} />`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags namespaced on:event with array expression", () => {
    const result = runRule(solidNoArrayHandlers, `<button on:click={[handler, data]} />`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
