import { describe, expect, it } from "vite-plus/test";
import eslintPlugin from "../src/index.js";

const createNavWithRedundantRole = () => ({
  type: "JSXOpeningElement",
  name: { type: "JSXIdentifier", name: "nav" },
  attributes: [
    {
      type: "JSXAttribute",
      name: { type: "JSXIdentifier", name: "role" },
      value: { type: "Literal", value: "navigation" },
    },
  ],
});

describe("eslint-plugin-react-doctor", () => {
  it("declares an object options schema for wrapped rules", () => {
    expect(eslintPlugin.rules["no-redundant-roles"].meta.schema).toEqual([
      { type: "object", additionalProperties: true },
    ]);
  });

  it("maps ESLint rule options into react-doctor settings", () => {
    const reports: string[] = [];
    const rule = eslintPlugin.rules["no-redundant-roles"];
    const visitors = rule.create({
      report: (descriptor) => reports.push(descriptor.message),
      getFilename: () => "src/app.tsx",
      options: [{ exceptions: { nav: ["navigation"] } }],
    });

    visitors.JSXOpeningElement?.(createNavWithRedundantRole());

    expect(reports).toEqual([]);
  });
});
