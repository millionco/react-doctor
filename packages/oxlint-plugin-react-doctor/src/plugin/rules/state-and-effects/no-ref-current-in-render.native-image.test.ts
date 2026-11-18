import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRefCurrentInRender } from "./no-ref-current-in-render.js";

const nativeImage = `import * as React from "react";
export function useImageReady(isHydrated: boolean) {
  const imageRef = React.useRef<HTMLImageElement | null>(null);
  const image = (() => {
    if (!isHydrated) return null;
    if (!imageRef.current) {
      imageRef.current = new window.Image();
    }
    return imageRef.current;
  })();
  return image;
}
`;

const guard = "if (!imageRef.current)";
const assignment = "imageRef.current = new window.Image();";
const refDeclaration = "  const imageRef";
const abort = "if (!isHydrated) return null;";
const invocationStart = "  const image = (() => {";
const invocationEnd = "  })();\n  return image;";

const reportsConstruction = (source: string): boolean => {
  const result = runRule(noRefCurrentInRender, source, {
    filename: "fixture.tsx",
    includeLocations: true,
  });
  expect(result.parseErrors).toEqual([]);
  const line = source.split("\n").findIndex((row) => row.trim() === assignment) + 1;
  expect(line).toBeGreaterThan(0);
  return result.diagnostics.some((diagnostic) => diagnostic.line === line);
};

describe("no-ref-current-in-render native image initialization", () => {
  it.each([
    nativeImage,
    nativeImage.replace(guard, "if (imageRef.current === null)"),
    nativeImage.replace(abort, ""),
    nativeImage.replace(
      refDeclaration,
      `  const timer = window.setTimeout(() => {}, 100);
  window.clearTimeout(timer);
${refDeclaration}`,
    ),
  ])("accepts a closed synchronous image initialization", (source) => {
    expect(reportsConstruction(source)).toBe(false);
  });

  it.each([
    ["another guard", nativeImage.replace(guard, "if (!isHydrated)")],
    [
      "a side effect in the abort arm",
      nativeImage.replace(abort, "if (!isHydrated) { setup(); return null; }"),
    ],
    ["an effectful abort predicate", nativeImage.replace(abort, "if (!initialize()) return null;")],
    ["an ambient abort binding", nativeImage.replace(abort, "if (!ambientHydration) return null;")],
    [
      "an unguarded later reset",
      nativeImage.replace(invocationEnd, "  })();\n  imageRef.current = null;\n  return image;"),
    ],
    [
      "a deferred competing writer",
      nativeImage.replace(
        invocationEnd,
        "  })();\n  React.useEffect(() => { imageRef.current = {} as HTMLImageElement; }, []);\n  return image;",
      ),
    ],
    [
      "a duplicate writer in the guard",
      nativeImage.replace(assignment, `${assignment}\n      imageRef.current = fallback;`),
    ],
    ["an escaped ref", nativeImage.replace("return image;", "return imageRef;")],
    [
      "a parameterized IIFE",
      nativeImage.replace("(() =>", "((gate) =>").replace("})();", "})(isHydrated);"),
    ],
    ["an async IIFE", nativeImage.replace("(() =>", "(async () =>")],
    [
      "an IIFE nested inside another call",
      nativeImage
        .replace(invocationStart, "  const image = wrap((() => {")
        .replace(invocationEnd, "  })());\n  return image;"),
    ],
    [
      "an IIFE in a loop",
      nativeImage
        .replace(invocationStart, "  for (const retry of attempts) { (() => {")
        .replace(invocationEnd, "  })(); }\n  return null;"),
    ],
    [
      "an IIFE nested in an IIFE",
      nativeImage
        .replace(invocationStart, "  const image = (() => (() => {")
        .replace(invocationEnd, "  })())();\n  return image;"),
    ],
    [
      "a timer function with a WindowProxy receiver",
      nativeImage.replace(
        refDeclaration,
        "  window.setTimeout(function () { this.Image = makeImage; }, 0);\n  const imageRef",
      ),
    ],
    [
      "a timer arrow containing an ordinary nested function with a WindowProxy receiver",
      nativeImage.replace(
        refDeclaration,
        "  window.setTimeout(() => { (function () { this.Image = makeImage; })(); }, 0);\n  const imageRef",
      ),
    ],
    [
      "a member reached through a default React import",
      nativeImage.replace('import * as React from "react";', 'import React from "react";'),
    ],
    [
      "a rewritten namespace React member",
      nativeImage.replace(refDeclaration, "  React.useRef = fakeRef;\n  const imageRef"),
    ],
    [
      "a namespace React member assigned through destructuring",
      nativeImage.replace(refDeclaration, "  [React.useRef] = [fakeRef];\n  const imageRef"),
    ],
    [
      "a second default React import with a rewritten member",
      nativeImage.replace(
        'import * as React from "react";',
        'import DefaultReact, * as React from "react";\nDefaultReact.useRef = fakeRef;',
      ),
    ],
    [
      "a global event callback with a window target",
      nativeImage.replace(
        refDeclaration,
        "  addEventListener('load', (event) => { event.currentTarget.Image = makeImage; });\n  const imageRef",
      ),
    ],
    [
      "a global event handler property with a window target",
      nativeImage.replace(
        refDeclaration,
        "  onmessage = (event) => { event.currentTarget.Image = makeImage; };\n  const imageRef",
      ),
    ],
    [
      "a shadowed window",
      nativeImage.replace("isHydrated: boolean)", "isHydrated: boolean, window: Window)"),
    ],
    [
      "a proxied window",
      nativeImage.replace(
        refDeclaration,
        "  const window = new Proxy(otherWindow, {});\n  const imageRef",
      ),
    ],
    [
      "an overwritten constructor",
      nativeImage.replace(refDeclaration, "  window.Image = makeImage;\n  const imageRef"),
    ],
    [
      "a constructor replaced with Reflect",
      nativeImage.replace(
        refDeclaration,
        '  Reflect.set(window, "Image", makeImage);\n  const imageRef',
      ),
    ],
    [
      "a constructor replaced by destructuring",
      nativeImage.replace(refDeclaration, "  [window.Image] = [makeImage];\n  const imageRef"),
    ],
    [
      "a getter installed for the constructor",
      nativeImage.replace(
        refDeclaration,
        '  Object.defineProperty(window, "Image", { get: () => makeImage });\n  const imageRef',
      ),
    ],
    [
      "an aliased window",
      nativeImage.replace(
        refDeclaration,
        "  const browser = window;\n  browser.Image = makeImage;\n  const imageRef",
      ),
    ],
    [
      "an alternate global provider",
      nativeImage.replace(refDeclaration, "  globalThis.Image = makeImage;\n  const imageRef"),
    ],
    ["a shadowed element type", `type HTMLImageElement = { other: string };\n${nativeImage}`],
    [
      "a generic parameter shadow",
      nativeImage.replace("useImageReady(", "useImageReady<HTMLImageElement>("),
    ],
    [
      "ambient DOM augmentation",
      `declare global { interface HTMLImageElement { other: string } }\n${nativeImage}`,
    ],
    ["a non-null initial value", nativeImage.replace(">(null);", ">(existingImage);")],
    [
      "an uncertain ref domain",
      nativeImage.replace("HTMLImageElement | null", "HTMLImageElement | false | null"),
    ],
  ])("retains the construction diagnostic for %s", (_name, source) => {
    expect(reportsConstruction(source)).toBe(true);
  });

  it("reports a compound write involving the native construction", () => {
    const result = runRule(
      noRefCurrentInRender,
      nativeImage.replace(assignment, "imageRef.current += new window.Image();"),
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports when the native constructor receives an argument", () => {
    const result = runRule(
      noRefCurrentInRender,
      nativeImage.replace("new window.Image()", "new window.Image(64)"),
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
