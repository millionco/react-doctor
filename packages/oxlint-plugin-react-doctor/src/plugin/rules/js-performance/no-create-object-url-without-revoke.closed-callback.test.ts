import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noCreateObjectUrlWithoutRevoke } from "./no-create-object-url-without-revoke.js";

const source = `import * as React from "react";
export function Preview({ blob, mode }) {
  const [preview, setPreview] = React.useState("");
  const show = React.useCallback((file, large = false) => {
    if (!large) setPreview(URL.createObjectURL(file));
    else setPreview(URL.createObjectURL(file));
  }, []);
  const open = React.useCallback(() => show(blob, false), [show]);
  return <button onClick={open}>{preview}</button>;
}`;

const findingLines = (code: string) => {
  const result = runRule(noCreateObjectUrlWithoutRevoke, code, { includeLocations: true });
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics.map((diagnostic) => diagnostic.line);
};

describe("literal Boolean arguments to a private memoized callback", () => {
  it("reports the executed arm when every caller passes false", () => {
    expect(findingLines(source)).toEqual([5]);
  });

  it("reports the executed arm when every caller passes true", () => {
    expect(findingLines(source.replace("show(blob, false)", "show(blob, true)"))).toEqual([6]);
  });

  it.each([
    ["unknown argument", source.replace("show(blob, false)", "show(blob, mode)")],
    [
      "mixed arguments",
      source.replace("show(blob, false)", "(show(blob, false), show(blob, true))"),
    ],
    ["callback escape", source.replace("  const open", "  publish(show);\n  const open")],
    [
      "parameter write",
      source.replace("    if (!large)", "    [large] = [true];\n    if (!large)"),
    ],
    ["runtime provider escape", source.replace("  const open", "  expose(React);\n  const open")],
    [
      "shifted callback arguments",
      source.replace("  const open", "  React.useCallback(...[], [show]);\n  const open"),
    ],
    ["sparse dependencies", source.replace("[show]", "[marker, , show]")],
    ["spread dependencies", source.replace("[show]", "[...getDependencies(), show]")],
    [
      "runtime React mock",
      source.replace("export function", 'vi.mock("react", makeMock);\nexport function'),
    ],
    [
      "modified dependency comparator",
      source.replace("export function", "Object.is = compare;\nexport function"),
    ],
  ])("keeps both allocation warnings for %s", (_case, code) => {
    expect(findingLines(code)).toHaveLength(2);
  });

  it("keeps both warnings when a prior aliased Hook can change the memo slot", () => {
    const conditional = source
      .replace(
        'import * as React from "react";',
        'import { useCallback as memo, useState } from "react";',
      )
      .replaceAll("React.useCallback", "memo")
      .replaceAll("React.useState", "useState")
      .replace("  const show", "  if (mode) install(memo(() => {}, []));\n  const show")
      .replace("  const open", "  if (!mode) memo(() => {}, []);\n  const open");
    expect(findingLines(conditional)).toHaveLength(2);
  });

  it("allows a later custom Hook after the unconditional callback slot", () => {
    const laterHook = source.replace(
      "  const open",
      "  const label = usePreviewLabel();\n  const open",
    );
    expect(findingLines(laterHook)).toEqual([5]);
  });
});
