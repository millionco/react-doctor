import { describe, expect, it } from "vite-plus/test";
import { parseStaticRadialGradient } from "./parse-static-radial-gradient.js";

describe("parseStaticRadialGradient", () => {
  it("parses gradients with and without a radial prelude", () => {
    expect(
      parseStaticRadialGradient(
        "radial-gradient(circle at center, rgb(37 99 235 / 80%) 0%, transparent 70%)",
      ),
    ).toHaveLength(2);
    expect(parseStaticRadialGradient("radial-gradient(#2563ebcc, #2563eb00)")).toHaveLength(2);
  });

  it("rejects repeating, layered, and unresolved gradients", () => {
    expect(
      parseStaticRadialGradient("repeating-radial-gradient(#2563ebcc, transparent)"),
    ).toBeNull();
    expect(
      parseStaticRadialGradient(
        "radial-gradient(#2563ebcc, transparent), linear-gradient(white, black)",
      ),
    ).toBeNull();
    expect(parseStaticRadialGradient("radial-gradient(var(--halo), transparent)")).toBeNull();
    expect(parseStaticRadialGradient("radial-gradient(blue, #2563ebcc, transparent)")).toBeNull();
  });
});
