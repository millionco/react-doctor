import { describe, expect, it } from "vite-plus/test";
import { isDeferredFactoryExport } from "./is-deferred-factory-export.js";

const factory = `
  export function defer<Callback extends (...args: unknown[]) => void>(
    callback: Callback, delay = 200,
  ) {
    let scheduled: ReturnType<typeof setTimeout>;
    return (...args: Parameters<Callback>) => {
      clearTimeout(scheduled);
      scheduled = setTimeout(() => { callback(...args); }, delay);
    };
  }
`;

const matchesFactory = (code: string): boolean =>
  isDeferredFactoryExport("/timers.ts", code, "defer");

describe("isDeferredFactoryExport", () => {
  it("recognizes a named timer factory with a private timer handle", () => {
    expect(matchesFactory(factory)).toBe(true);
  });

  it.each([
    "export function defer(callback) { return (...args) => callback(...args); }",
    "export function defer(callback) { let previous; return (value) => { if (previous === value) return; previous = value; callback(value); }; }",
    factory.replace("return (...args:", "callback(); return (...args:"),
    factory.replace("delay = 200", "setTimeout = 200"),
    factory.replace("clearTimeout(scheduled);", "clearTimeout(otherTimer);"),
    factory.replace("}, delay);", "}, globalDelay);"),
    factory.replace("callback(...args);", "callback(next);"),
    factory.replace("delay = 200", "delay = 0"),
  ])("rejects a different callback or timer route", (code) => {
    expect(matchesFactory(code)).toBe(false);
  });
});
