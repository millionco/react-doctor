import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const factory = `const readPreference = (query: string) => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
  return window.matchMedia(query);
};`;
const subscriptionBody = `
    const result = readPreference(query);
    if (!result) return () => undefined;
    if (typeof result.addEventListener === "function") {
      result.addEventListener("change", notify);
      return () => result.removeEventListener("change", notify);
    }
    const legacy = result as Pick<MediaQueryList, "addListener" | "removeListener">;
    legacy.addListener(notify);
    return () => legacy.removeListener?.(notify);`;
const stockSubscribe = (body = subscriptionBody, factoryCode = factory) => `
import { useCallback, useSyncExternalStore } from "react";
declare function retain(value: unknown): void;
${factoryCode}
export function usePreference(query: string) {
  const subscribe = useCallback((notify: () => void) => {${body}
  }, [query]);
  return useSyncExternalStore(subscribe, () => readPreference(query)?.matches ?? false, () => false);
}`;

const run = (source: string, mode: "curated" | "upstream") => {
  const result = runRule(effectNeedsCleanup, source, {
    settings: { "react-doctor": { portedRuleMode: mode } },
  });
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics;
};

describe.each(["curated", "upstream"] as const)(
  "local matchMedia subscription cleanup (%s)",
  (mode) => {
    it("pairs a stored native receiver with the returned legacy cleanup", () => {
      expect(run(stockSubscribe(), mode)).toHaveLength(0);
    });

    it("pairs the legacy cleanup in an inline subscription", () => {
      const source = `
import { useSyncExternalStore } from "react";
${factory}
export function usePreference(query: string) {
  return useSyncExternalStore((notify) => {${subscriptionBody}
  }, () => false, () => false);
}`;
      expect(run(source, mode)).toHaveLength(0);
    });

    it.each([
      [
        "receiver escape",
        subscriptionBody.replace(
          "    legacy.addListener",
          "    retain({ result });\n    legacy.addListener",
        ),
        factory,
      ],
      [
        "cleanup removed",
        subscriptionBody.replace(
          "return () => legacy.removeListener?.(notify);",
          "return () => undefined;",
        ),
        factory,
      ],
      ["wrong handler", subscriptionBody.replace("?.(notify)", "?.(() => undefined)"), factory],
      [
        "receiver alias mutation",
        subscriptionBody.replace(
          "return () => legacy",
          "legacy.removeListener = () => {};\n    return () => legacy",
        ),
        factory,
      ],
      [
        "non-native factory return",
        subscriptionBody,
        factory.replace("return;", "return { addListener() {}, removeListener() {} }; "),
      ],
      [
        "browser factory replacement",
        subscriptionBody,
        `document.defaultView!.matchMedia = () => ({}) as MediaQueryList;\n${factory}`,
      ],
      [
        "prototype escape",
        subscriptionBody,
        `const original = globalThis.MediaQueryList.prototype;\nretain(original);\n${factory}`,
      ],
      [
        "unrelated second receiver",
        subscriptionBody.replace("legacy.removeListener", "readPreference(query)?.removeListener"),
        factory,
      ],
    ])("keeps the legacy warning for %s", (_name, body, factoryCode) => {
      const findings = run(stockSubscribe(body, factoryCode), mode);
      expect(findings.some(({ message }) => message.includes("`addListener`"))).toBe(true);
    });

    it("keeps a warning when a spread changes the actual native listener", () => {
      const setup = `
    const result = readPreference(query);
    if (!result) return () => undefined;
    const change = (event: Event) => Reflect.set(event.currentTarget!, "removeListener", undefined);
    result.addEventListener(...(["change", change] as const), notify as unknown as boolean);
    result.addListener(notify);
    return () => {
      result.removeEventListener("change", change);
      result.removeListener?.(notify);
    };`;
      expect(
        run(stockSubscribe(setup), mode).some(({ message }) =>
          message.includes("`addEventListener`"),
        ),
      ).toBe(true);
    });
  },
);
