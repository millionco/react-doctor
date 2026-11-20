import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const component = `
import { useEffect } from "react";
import Maps from "mapbox-gl";
export const MiniMap = ({ container, ready }: { container: HTMLElement; ready: () => void }) => {
  useEffect(() => {
    const map = new Maps.Map({ container });
    map.on("load", () => ready());
    return () => map.remove();
  }, [container, ready]);
  return null;
};
`;

const warnings = (source: string) => {
  const result = runRule(effectNeedsCleanup, source);
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics.length;
};

describe("effect-needs-cleanup — Mapbox load listener", () => {
  it("accepts a private stock map disposed by its own cleanup", () => {
    expect(warnings(component)).toBe(0);
  });

  it("accepts a private ref with one store and a cleanup reset", () => {
    const source = component
      .replace("import { useEffect }", "import { useEffect, useRef }")
      .replace("  useEffect(() => {", "  const handle = useRef(null);\n  useEffect(() => {")
      .replace('    map.on("load",', '    handle.current = map;\n    map.on("load",')
      .replace(
        "return () => map.remove();",
        "return () => { map.remove(); handle.current = null; };",
      );
    expect(warnings(source)).toBe(0);
    expect(warnings(source.replace(" handle.current = null;", ""))).toBe(1);
    expect(
      warnings(source.replace("handle.current = map;", "handle.current = map; share(handle);")),
    ).toBe(1);
  });

  it("requires a guaranteed release of the registered receiver", () => {
    expect(warnings(component.replace("return () => map.remove();", ""))).toBe(1);
    expect(
      warnings(
        component.replace("return () => map.remove();", "return () => { if (ok) map.remove(); };"),
      ),
    ).toBe(1);
    expect(
      warnings(component.replace("return () => map.remove();", "return () => otherMap.remove();")),
    ).toBe(1);
    expect(
      warnings(
        component.replace(
          "return () => map.remove();",
          "return () => { beforeRelease(); map.remove(); };",
        ),
      ),
    ).toBe(1);
  });

  it("requires stock load registration and a closed receiver", () => {
    expect(warnings(component.replace('"mapbox-gl"', '"other-maps"'))).toBe(1);
    expect(warnings(component.replace('"load"', '"move"'))).toBe(1);
    expect(
      warnings(
        component.replace(
          'map.on("load", () => ready());',
          'share(map.on("load", () => ready()));',
        ),
      ),
    ).toBe(1);
    expect(
      warnings(
        component.replace(
          "const map = new Maps.Map({ container });",
          "const map = new Maps.Map({ container });\n    share(map);",
        ),
      ),
    ).toBe(1);
    expect(
      warnings(component.replace("() => ready());", '() => share(map.getSource("data")));')),
    ).toBe(1);
    expect(warnings(component.replace("() => ready());", "event => share(event.target));"))).toBe(
      1,
    );
  });

  it("refuses mutable provider bindings and options with an external callback", () => {
    const replacement = component.replace(
      'import Maps from "mapbox-gl";',
      'import Maps from "mapbox-gl";\nimport Other from "mapbox-gl";\nOther.Map.prototype.remove = () => {};',
    );
    expect(warnings(replacement)).toBe(1);
    expect(warnings(component.replace("{ container }", "{ container, devtools: true }"))).toBe(1);
    expect(
      warnings(component.replace("{ container }", "{ container, transformRequest: intercept }")),
    ).toBe(1);
    expect(
      warnings(
        component.replace(
          '    map.on("load",',
          '    map.addControl(customControl);\n    map.on("load",',
        ),
      ),
    ).toBe(1);
  });
});
