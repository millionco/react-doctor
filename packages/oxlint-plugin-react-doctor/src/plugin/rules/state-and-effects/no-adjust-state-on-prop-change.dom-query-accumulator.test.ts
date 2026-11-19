import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";

const measure = (
  query = 'document.querySelectorAll(".content h2")',
  text = "node.textContent + ''",
) =>
  [
    `const nodes = ${query};`,
    "const entries = [];",
    "nodes.forEach((node) => {",
    "  const id = node.id;",
    "  const level = +node.tagName.replace('H', '');",
    `  const text = ${text};`,
    "  entries.push({ id, level, text });",
    "});",
    "setEntries(entries);",
  ].join("\n");

const scanEffect = (source: string, beforeEffect = "", output = "null") => {
  const result = runRule(
    noAdjustStateOnPropChange,
    `import { useEffect, useState } from "react";
     export function Contents({ slug }: { slug: string }) {
       const [entries, setEntries] = useState([]);
       const [label, setLabel] = useState("");
       ${beforeEffect}
       useEffect(() => {
         ${source}
       }, [slug]);
       return ${output};
     }`,
    { includeLocations: true },
  );
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics;
};

describe("no-adjust-state-on-prop-change DOM query accumulation", () => {
  it("accepts a private collection of scalar DOM measurements", () => {
    expect(scanEffect(measure())).toEqual([]);
  });

  it("reports a separate prop-driven write after the measurements", () => {
    expect(scanEffect(`${measure()}\nsetLabel("stale");`)).toEqual([
      expect.objectContaining({ line: 16 }),
    ]);
  });

  it("reports a row that copies a prop", () => {
    expect(scanEffect(measure(undefined, "slug"))).toHaveLength(1);
  });

  it("reports a query that uses an unknown receiver", () => {
    expect(scanEffect(measure('replacementDocument.querySelectorAll("h2")'))).toHaveLength(1);
  });

  it("reports after a host ref replaces the query", () => {
    expect(
      scanEffect(
        measure(),
        "",
        "<section ref={element => { if (element) element.ownerDocument.querySelectorAll = replacement; }} />",
      ),
    ).toHaveLength(1);
  });

  it("reports after a same-realm frame alias replaces the query", () => {
    expect(scanEffect(measure(), "frames.document.querySelectorAll = replacement;")).toHaveLength(
      1,
    );
  });

  it("reports when a custom element overrides a measured property", () => {
    expect(
      scanEffect(
        measure('document.querySelectorAll("span")'),
        "class Caption extends HTMLSpanElement { get textContent() { return slug; } } customElements.define('owned-caption', Caption, { extends: 'span' });",
        '<span is="owned-caption" />',
      ),
    ).toHaveLength(1);
  });
});
