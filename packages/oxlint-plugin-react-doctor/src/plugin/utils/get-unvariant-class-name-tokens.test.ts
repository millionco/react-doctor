import { describe, expect, it } from "vite-plus/test";
import { getUnvariantClassNameTokens } from "./get-unvariant-class-name-tokens.js";

describe("getUnvariantClassNameTokens", () => {
  it("keeps base utilities and arbitrary-property colons", () => {
    expect(
      getUnvariantClassNameTokens("p-4 !text-lg [background:linear-gradient(#fff,#000)]"),
    ).toEqual(["p-4", "text-lg", "[background:linear-gradient(#fff,#000)]"]);
  });

  it("drops responsive and state variants", () => {
    expect(getUnvariantClassNameTokens("p-4 md:p-8 hover:p-6 dark:text-white")).toEqual(["p-4"]);
  });
});
