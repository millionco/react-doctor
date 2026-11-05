import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectObserverNeedsDisconnect } from "./effect-observer-needs-disconnect.js";

const replacement = `const replacement = document.createElement("div");
      replacement.id = "preview";
      observed.replaceWith(replacement);`;
const postcondition = "if (document.contains(observed)) return;";
const release = `ids.forEach((id) => {
        const target = document.getElementById(id);
        if (target) observer.unobserve(target);
      });`;
const source = `import { useEffect } from "react";
export const usePreview = () => {
  useEffect(() => {
    const ids = ["preview"];
    let observed;
    const observer = new ResizeObserver(() => {});
    ids.forEach((id) => {
      const target = document.getElementById(id);
      if (target) {
        observed = target;
        observer.observe(target);
      }
    });
    return () => {
      if (!observed) return;
      ${replacement}
      ${postcondition}
      ${release}
    };
  }, []);
};`;

describe("effect observer cleanup after a captured element is detached", () => {
  it("reports that the fresh lookup cannot release the captured watched node", () => {
    const result = runRule(effectObserverNeedsDisconnect, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("unobserve()` with the original element");
  });

  it("recognizes the same detached lookup alongside an unrelated exported function", () => {
    const result = runRule(
      effectObserverNeedsDisconnect,
      source.replace(
        "export const",
        "export function label(value) { return value.trim(); } export const",
      ),
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["stable lookup", source.replace(replacement, "").replace(postcondition, "")],
    ["a possible rather than proven detachment", source.replace(postcondition, "")],
    [
      "release before replacement",
      source
        .replace(replacement, "")
        .replace(postcondition, "")
        .replace(release, `${release}\n${replacement}`),
    ],
    ["disconnect after replacement", source.replace(release, "observer.disconnect();")],
    ["a different captured binding", source.replace("observed = target;", "observed = other;")],
    [
      "an escaping captured object",
      source.replace(postcondition, `save(observed); ${postcondition}`),
    ],
    [
      "an opaque operation before the check",
      source.replace(postcondition, `moveNodes(); ${postcondition}`),
    ],
    [
      "an opaque operation after the check",
      source.replace(postcondition, `${postcondition} moveNodes();`),
    ],
    [
      "reattachment after the check",
      source.replace(postcondition, `${postcondition} document.body.append(observed);`),
    ],
    ["multiple collection elements", source.replace('["preview"]', '["preview", "other"]')],
    [
      "an overwritten document lookup",
      source.replace("export const", "document.getElementById = customLookup; export const"),
    ],
    [
      "an overwritten document check",
      source.replace("export const", "document.contains = customContains; export const"),
    ],
    [
      "an overwritten array method",
      source.replace("export const", "Array.prototype.forEach = customIteration; export const"),
    ],
    [
      "an aliased array prototype",
      source.replace(
        "export const",
        "const { __proto__: proto } = []; proto.forEach = customIteration; export const",
      ),
    ],
    [
      "a legacy getter which returns the previously watched node",
      source.replace(
        "export const",
        `let captured; document.__defineGetter__("getElementById", () =>
          () => captured ??= document.querySelector("#preview")); export const`,
      ),
    ],
    [
      "an escaping document provider",
      source.replace("export const", "register(document); export const"),
    ],
    [
      "an escaping observer constructor",
      source.replace("export const", "register(ResizeObserver); export const"),
    ],
    ["an empty singleton ID", source.replaceAll('"preview"', '""')],
    [
      "an invalid element creation name",
      source.replace('createElement("div")', 'createElement("")'),
    ],
    [
      "a quoted document alias",
      source.replace(
        "export const",
        `const { "document": active } = top;
         active.getElementById = customLookup; export const`,
      ),
    ],
    [
      "an owner-document alias",
      source.replace(
        "export const",
        `export function patchLookup(node) {
          const active = node.ownerDocument;
          active.getElementById = customLookup;
        }
        export const`,
      ),
    ],
    [
      "a destructured protected method write",
      source.replace(
        "export const",
        "export function patchLookup(provider) { ({ value: provider.getElementById } = patch); } export const",
      ),
    ],
    [
      "a for-of protected method write",
      source.replace(
        "export const",
        "export function patchLookup(provider) { for (provider.getElementById of replacements) {} } export const",
      ),
    ],
    [
      "a defined replacement method",
      source.replace(
        "export const",
        `export function patchLookup(provider) {
          Object.defineProperty(provider, "getElementById", descriptor);
        }
        export const`,
      ),
    ],
  ])("preserves the existing result for %s", (_name, code) => {
    const result = runRule(effectObserverNeedsDisconnect, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
