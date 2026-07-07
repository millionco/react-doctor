import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAccessKey } from "./no-access-key.js";

describe("a11y/no-access-key regressions", () => {
  for (const filename of [
    "src/ebay-toast-dialog/__tests__/index.stories.tsx",
    "src/ebay-snackbar-dialog/__tests__/index.stories.tsx",
  ]) {
    it(`does not flag a design-system accessKey demo in ${filename}`, () => {
      const result = runRule(noAccessKey, `<EbayToastDialogAction accessKey="u" />`, {
        filename,
      });
      expect(result.diagnostics).toEqual([]);
    });
  }

  it("still flags accessKey in production code", () => {
    const result = runRule(noAccessKey, `<button accessKey="s">Save</button>`, {
      filename: "src/components/save-button.tsx",
    });
    expect(result.diagnostics).toHaveLength(1);
  });
});
