import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const modernRegistration = `const listener = () => update(media.matches);
    let dispose: (() => void) | undefined;
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", listener);
      dispose = () => media.removeEventListener("change", listener);
    } else if (typeof media.addListener === "function") {
      media.addListener(listener);
      dispose = () => media.removeListener(listener);
    }
    return dispose;`;

const fixture = (
  body = modernRegistration,
  beforeEffect = "",
  hook = "useEffect",
  beforeImports = "",
) => `
import React, { useEffect } from "react";
declare function retain(value: unknown): void;
${beforeImports}
export function Contrast({ query, update }: { query: string; update: (matches: boolean) => void }) {
  ${beforeEffect}
  ${hook}(() => {
    const media = window.matchMedia(query);
    ${body}
  }, [query, update]);
  return null;
}`;

const inspect = (source: string, mode: "curated" | "upstream") => {
  const result = runRule(effectNeedsCleanup, source, {
    settings: { "react-doctor": { portedRuleMode: mode } },
  });
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics;
};

describe.each(["curated", "upstream"] as const)(
  "branch-assigned native media disposer (%s)",
  (mode) => {
    it("returns the cleanup assigned after each available native registration", () => {
      expect(inspect(fixture(), mode)).toHaveLength(0);
    });

    it("recognizes the stock effect behind a browser availability choice", () => {
      const source = fixture(
        modernRegistration,
        `const useBrowserEffect = typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;`,
        "useBrowserEffect",
      );
      expect(inspect(source, mode)).toHaveLength(0);
    });

    it("recognizes a conditional unary-only listener", () => {
      const source = fixture(`const listener = () => update(media.matches);
    let dispose: (() => void) | undefined;
    if (typeof media.addListener === "function") {
      media.addListener(listener);
      dispose = () => media.removeListener(listener);
    }
    return dispose;`);
      expect(inspect(source, mode)).toHaveLength(0);
    });

    it.each([
      [
        "cleanup assigned to the wrong receiver",
        modernRegistration
          .replace("media.removeEventListener", "other.removeEventListener")
          .replace("let dispose", `const other = window.matchMedia(query);\n    let dispose`),
      ],
      [
        "cleanup assigned with a different listener",
        modernRegistration.replace(
          `removeEventListener("change", listener)`,
          `removeEventListener("change", () => update(false))`,
        ),
      ],
      [
        "cleanup default parameter runs before release",
        modernRegistration.replace(
          `() => media.removeEventListener`,
          `(_ = (() => { throw new Error("before cleanup"); })()) => media.removeEventListener`,
        ),
      ],
      [
        "registration can return before the assignment",
        modernRegistration.replace(
          `dispose = () => media.removeEventListener`,
          `if (query) return undefined;\n      dispose = () => media.removeEventListener`,
        ),
      ],
      [
        "receiver escapes",
        modernRegistration.replace("let dispose", `retain(media);\n    let dispose`),
      ],
      [
        "release is replaced through the receiver",
        modernRegistration.replace(
          "let dispose",
          `Object.defineProperty(media, "removeEventListener", { value: () => {} });\n    let dispose`,
        ),
      ],
      [
        "listener can mutate its event target",
        modernRegistration.replace(
          `() => update(media.matches)`,
          `(event: Event) => Reflect.set(event.currentTarget!, "removeEventListener", undefined)`,
        ),
      ],
      [
        "disposer is overwritten after registration",
        modernRegistration.replace(
          "return dispose;",
          `dispose = () => undefined;\n    return dispose;`,
        ),
      ],
      [
        "capture options may change",
        modernRegistration.replace(
          `addEventListener("change", listener)`,
          `addEventListener("change", listener, { capture: true })`,
        ),
      ],
    ])("preserves the diagnostic when %s", (_name, body) => {
      expect(inspect(fixture(body), mode).length).toBeGreaterThan(0);
    });

    it("rejects a React effect provider with a visible replacement", () => {
      const source = fixture(
        modernRegistration,
        "",
        "React.useEffect",
        `React.useEffect = (setup) => { setup(); };`,
      );
      expect(inspect(source, mode).length).toBeGreaterThan(0);
    });
  },
);
