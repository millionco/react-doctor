import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { dialogHasAccessibleName } from "./dialog-has-accessible-name.js";

describe("a11y/dialog-has-accessible-name regressions", () => {
  const UNNAMED_DIALOG = `export const Harness = () => <div role="dialog">{children}</div>;`;

  for (const filename of [
    "test/unit/FloatingFocusManager.test.tsx",
    "src/hooks/use-focus-trap.test.tsx",
    "app/pages/checkout/partials/shipping-address.test.js",
    "src/table/table-role/__tests__/stubs.tsx",
    "src/components/sharing/DuplicatesTab.test.jsx",
  ]) {
    it(`does not flag test scaffolding dialogs in ${filename}`, () => {
      const result = runRule(dialogHasAccessibleName, UNNAMED_DIALOG, { filename });
      expect(result.diagnostics).toEqual([]);
    });
  }

  it("still flags an unnamed dialog in production code", () => {
    const result = runRule(dialogHasAccessibleName, UNNAMED_DIALOG, {
      filename: "src/components/settings-modal.tsx",
    });
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still stays quiet for a labelled dialog in production code", () => {
    const result = runRule(
      dialogHasAccessibleName,
      `export const Modal = () => <div role="dialog" aria-labelledby="modal-title">{children}</div>;`,
      { filename: "src/components/settings-modal.tsx" },
    );
    expect(result.diagnostics).toEqual([]);
  });
});
