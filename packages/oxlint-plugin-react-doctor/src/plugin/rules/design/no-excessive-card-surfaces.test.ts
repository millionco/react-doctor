import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noExcessiveCardSurfaces } from "./no-excessive-card-surfaces.js";

describe("no-excessive-card-surfaces", () => {
  it("flags a page that boxes every group into a card", () => {
    const cards = Array.from(
      { length: 6 },
      (_, cardIndex) => `<section className="rounded-xl border p-6">Card ${cardIndex}</section>`,
    ).join("");
    const result = runRule(noExcessiveCardSurfaces, `const Page = () => <main>${cards}</main>;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a page with a restrained number of cards", () => {
    const result = runRule(
      noExcessiveCardSurfaces,
      `const Page = () => <main><section className="rounded-xl border p-6">A</section><section className="rounded-xl border p-6">B</section><section className="rounded-xl border p-6">C</section></main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
