import { describe, expect, it } from "vite-plus/test";
import { compileGlob } from "./compile-glob.js";

describe("compileGlob", () => {
  it("anchors exact patterns", () => {
    const regex = compileGlob("onClick");
    expect(regex.test("onClick")).toBe(true);
    expect(regex.test("onClickCapture")).toBe(false);
    expect(regex.test("myOnClick")).toBe(false);
  });

  it("expands * into a wildcard at any position", () => {
    expect(compileGlob("on*").test("onChange")).toBe(true);
    expect(compileGlob("on*").test("change")).toBe(false);
    expect(compileGlob("*Handler").test("clickHandler")).toBe(true);
    expect(compileGlob("*Handler").test("handlerClick")).toBe(false);
    expect(compileGlob("Foo*Bar").test("FooMiddleBar")).toBe(true);
  });

  it("escapes regex metacharacters in the pattern", () => {
    expect(compileGlob("a.b").test("a.b")).toBe(true);
    expect(compileGlob("a.b").test("axb")).toBe(false);
    expect(compileGlob("a+b").test("a+b")).toBe(true);
    expect(compileGlob("a+b").test("aab")).toBe(false);
  });

  it("returns the same cached instance with consistent matching across repeat calls", () => {
    const firstCall = compileGlob("render*");
    const secondCall = compileGlob("render*");
    expect(secondCall).toBe(firstCall);
    expect(firstCall.test("renderItem")).toBe(true);
    expect(secondCall.test("renderItem")).toBe(true);
    expect(secondCall.test("item")).toBe(false);
    expect(compileGlob("render*").test("renderRow")).toBe(true);
  });

  it("does not cross-contaminate different patterns", () => {
    const onPrefix = compileGlob("on*");
    const handlerSuffix = compileGlob("*Handler");
    expect(onPrefix).not.toBe(handlerSuffix);
    expect(onPrefix.test("onClick")).toBe(true);
    expect(onPrefix.test("clickHandler")).toBe(false);
    expect(handlerSuffix.test("clickHandler")).toBe(true);
    expect(handlerSuffix.test("onClick")).toBe(false);
  });

  it("compiles without stateful flags so cached instances are shareable", () => {
    const regex = compileGlob("on*Capture");
    expect(regex.flags).toBe("");
    expect(regex.test("onClickCapture")).toBe(true);
    expect(regex.test("onClickCapture")).toBe(true);
    expect(regex.lastIndex).toBe(0);
  });
});
