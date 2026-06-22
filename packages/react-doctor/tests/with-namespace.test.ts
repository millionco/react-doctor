import { describe, expect, it } from "vite-plus/test";
import { withNamespace } from "../src/cli/utils/with-namespace.js";

describe("withNamespace", () => {
  it("prefixes flat and dotted keys while preserving values", () => {
    expect(
      withNamespace("diag", {
        total: 3,
        "category.performance": 2,
        clean: false,
        topRule: "react-doctor/no-foo",
        omitted: null,
      }),
    ).toEqual({
      "diag.total": 3,
      "diag.category.performance": 2,
      "diag.clean": false,
      "diag.topRule": "react-doctor/no-foo",
      "diag.omitted": null,
    });
  });
});
