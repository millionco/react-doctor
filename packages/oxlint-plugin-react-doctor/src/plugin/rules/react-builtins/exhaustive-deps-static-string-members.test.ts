import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { exhaustiveDeps } from "./exhaustive-deps.js";

const run = (source: string, portedRuleMode: "curated" | "upstream" = "curated") => {
  const result = runRule(exhaustiveDeps, source, {
    settings: { "react-doctor": { portedRuleMode } },
  });
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics.map(({ message }) => message);
};

const effect = (read: string, dependencies: string) => `
  import { useEffect } from "react";
  export function Item({ model, choice }) {
    useEffect(() => { document.title = ${read}; }, [${dependencies}]);
    return null;
  }
`;

describe("exhaustive-deps static string member keys", () => {
  it.each([
    ["model.title", 'model["title"]'],
    ['model["title"]', "model.title"],
    ['model?.section.title ?? ""', 'model?.["section"]["title"]'],
  ])("matches the read %s with its equivalent dependency %s", (read, dependencies) => {
    const source = effect(read, dependencies);
    expect(run(source)).toEqual([]);
    expect(run(source, "upstream").length).toBeGreaterThan(0);
  });

  it.each(["model[choice]", 'model["sub.title"]', "model[0]", 'model["title"]()'])(
    "retains the complex expression and missing dependency warnings for %s",
    (dependency) => {
      const source = effect("model.title", dependency);
      expect(run(source)).toEqual(run(source, "upstream"));
      expect(run(source)).toEqual([
        expect.stringContaining("complex expression"),
        expect.stringContaining("Include `model.title`"),
      ]);
    },
  );

  it("reports a distinct property as missing and equal spellings as duplicates", () => {
    expect(run(effect("model.title", 'model["subtitle"]'))).toEqual([
      expect.stringContaining("Include `model.title`"),
    ]);
    expect(run(effect("model.title", 'model.title, model["title"]'))).toEqual([
      expect.stringContaining("lists `model.title` twice"),
    ]);
  });

  it("preserves the existing dependency policy for calls in the dependency array", () => {
    const source = effect('model["title"]()', "model.title()");
    expect(run(source)).toEqual(run(source, "upstream"));
    expect(run(source)).toEqual([expect.stringContaining("Include `model`")]);
  });

  it("keeps the mutable ref warning with either property spelling", () => {
    const source = `
      import { useEffect, useRef } from "react";
      export function Item() {
        const element = useRef(null);
        useEffect(() => { document.title = String(element.current); }, [element["current"]]);
        return null;
      }
    `;
    const dot = run(source.replace('element["current"]', "element.current"));
    expect(run(source)).toEqual(dot);
    expect(dot).toEqual([expect.stringContaining("since a ref never triggers a redraw")]);
  });
});
