import { describe, expect, it } from "vite-plus/test";
import { serializeTsObjectLiteral } from "../src/cli/utils/serialize-ts-object-literal.js";

describe("serializeTsObjectLiteral", () => {
  it("leaves identifier keys unquoted and quotes the rest", () => {
    expect(
      serializeTsObjectLiteral({
        lint: true,
        rules: { "react-doctor/no-danger": "off", noDanger: "warn" },
      }),
    ).toBe(
      `{
  lint: true,
  rules: {
    "react-doctor/no-danger": "off",
    noDanger: "warn"
  }
}`,
    );
  });

  it("serializes arrays and empty containers", () => {
    expect(serializeTsObjectLiteral({ ignore: { tags: ["design", "test-noise"] }, extra: {} }))
      .toBe(`{
  ignore: {
    tags: [
      "design",
      "test-noise"
    ]
  },
  extra: {}
}`);
    expect(serializeTsObjectLiteral([])).toBe("[]");
  });

  it("escapes string values via JSON", () => {
    expect(serializeTsObjectLiteral({ rootDir: 'a"b' })).toBe(`{
  rootDir: "a\\"b"
}`);
  });
});
