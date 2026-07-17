import { describe, expect, it } from "vite-plus/test";
import { getClassNameTokens } from "./get-class-name-tokens.js";

describe("getClassNameTokens", () => {
  it("strips hyphenated variants and important modifiers", () => {
    expect(
      getClassNameTokens(
        "group-hover:w-screen max-lg:text-[13px] md:!transition-all flex-shrink-0!",
      ),
    ).toEqual(["w-screen", "text-[13px]", "transition-all", "flex-shrink-0"]);
  });

  it("preserves colons inside arbitrary values and variants", () => {
    expect(
      getClassNameTokens(
        "bg-[color:rgb(0,0,0)] bg-[url(http://example.com/a.svg)] [&:hover]:stroke-red-500",
      ),
    ).toEqual(["bg-[color:rgb(0,0,0)]", "bg-[url(http://example.com/a.svg)]", "stroke-red-500"]);
  });
});
