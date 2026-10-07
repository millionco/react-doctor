import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noOversizedLongHeading } from "./no-oversized-long-heading.js";

const LONG_HEADING = "Build a better workflow for every team in your growing organization";

describe("no-oversized-long-heading", () => {
  it("flags long h1 copy at a Tailwind display size", () => {
    const result = runRule(
      noOversizedLongHeading,
      `const Hero = () => <h1 className="text-8xl">${LONG_HEADING}</h1>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a large explicit inline size", () => {
    const result = runRule(
      noOversizedLongHeading,
      `const Hero = () => <h1 style={{ fontSize: "5rem" }}>${LONG_HEADING}</h1>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts short display headlines", () => {
    const result = runRule(
      noOversizedLongHeading,
      `const Hero = () => <h1 className="text-9xl">Ship faster</h1>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts long headlines at a restrained size", () => {
    const result = runRule(
      noOversizedLongHeading,
      `const Hero = () => <h1 className="text-4xl">${LONG_HEADING}</h1>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat responsive display sizes as always active", () => {
    const result = runRule(
      noOversizedLongHeading,
      `const Hero = () => <h1 className="md:text-8xl">${LONG_HEADING}</h1>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for equal-priority and important class conflicts", () => {
    const result = runRule(
      noOversizedLongHeading,
      `const A = () => <h1 className="text-8xl text-4xl">${LONG_HEADING}</h1>;
       const B = () => <h1 className="text-4xl text-8xl">${LONG_HEADING}</h1>;
       const C = () => <h1 className="!text-8xl text-4xl!">${LONG_HEADING}</h1>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("uses inline size unless an unambiguous important utility overrides it", () => {
    const result = runRule(
      noOversizedLongHeading,
      `const A = () => <h1 className="text-8xl" style={{ fontSize: 32 }}>${LONG_HEADING}</h1>;
       const B = () => <h1 className="!text-8xl" style={{ fontSize: 32 }}>${LONG_HEADING}</h1>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when a spread can override the inferred size", () => {
    const result = runRule(
      noOversizedLongHeading,
      `const Hero = ({ props }) => <h1 className="text-8xl" {...props}>${LONG_HEADING}</h1>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("only interprets class font size when Tailwind is available", () => {
    const result = runRule(
      noOversizedLongHeading,
      `const A = () => <h1 className="text-8xl">${LONG_HEADING}</h1>;
       const B = () => <h1 style={{ fontSize: 80 }}>${LONG_HEADING}</h1>;`,
      { settings: { "react-doctor": { capabilities: [] } } },
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
