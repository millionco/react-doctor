import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noNumberedSectionMarkers } from "./no-numbered-section-markers.js";

describe("no-numbered-section-markers", () => {
  it("flags a sequence of decorative heading markers", () => {
    const result = runRule(
      noNumberedSectionMarkers,
      `const Page = () => <main>
        <section><span>01</span><h2>Principles</h2></section>
        <section><span>02</span><h2>Process</h2></section>
        <section><span>03</span><h2>Outcome</h2></section>
      </main>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a single numbered label", () => {
    const result = runRule(
      noNumberedSectionMarkers,
      `const Page = () => <section><span>01</span><h2>Step one</h2></section>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat nonconsecutive numbers as a decorative sequence", () => {
    const result = runRule(
      noNumberedSectionMarkers,
      `const Page = () => <main><span>01</span><h2>A</h2><span>03</span><h2>B</h2><span>05</span><h2>C</h2></main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
