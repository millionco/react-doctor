import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPlaceholderPersonaCopy } from "./no-placeholder-persona-copy.js";

describe("no-placeholder-persona-copy", () => {
  it("flags a generic persona rendered in page copy", () => {
    const result = runRule(
      noPlaceholderPersonaCopy,
      `const Page = () => <main><h1>Our customers</h1><p>Jane Doe</p><p>Product Designer</p></main>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores input placeholders", () => {
    const result = runRule(
      noPlaceholderPersonaCopy,
      `const Form = () => <main><label>Name<input placeholder="Jane Doe" /></label></main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores fixture data outside rendered page copy", () => {
    const result = runRule(
      noPlaceholderPersonaCopy,
      `const fixture = { name: "John Smith" }; const Card = () => <section>{fixture.name}</section>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
