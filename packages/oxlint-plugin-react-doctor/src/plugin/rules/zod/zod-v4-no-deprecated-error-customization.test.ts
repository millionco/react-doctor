import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { zodV4NoDeprecatedErrorCustomization } from "./zod-v4-no-deprecated-error-customization.js";

describe("zod-v4-no-deprecated-error-customization", () => {
  it("flags string message parameters on Zod factories", () => {
    const code = `
      import { z } from "zod";
      const schema = z.string("Required");
    `;
    const result = runRule(zodV4NoDeprecatedErrorCustomization, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags aliased named factory imports with legacy message parameters", () => {
    const code = `
      import { string as zString, number as zNumber } from "zod";
      const name = zString("Required");
      const age = zNumber("Age must be numeric");
    `;
    const result = runRule(zodV4NoDeprecatedErrorCustomization, code);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags invalid_type_error, required_error, and errorMap options", () => {
    const code = `
      import * as zod from "zod";
      const name = zod.string({ required_error: "Required" });
      const age = zod.number({ invalid_type_error: "Number" });
      const role = zod.enum(["admin"], { errorMap: () => ({ message: "Role" }) });
    `;
    const result = runRule(zodV4NoDeprecatedErrorCustomization, code);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("flags parse errorMap options on direct schema chains", () => {
    const code = `
      import { string } from "zod";
      string().parse(value, { errorMap: () => ({ message: "Bad" }) });
    `;
    const result = runRule(zodV4NoDeprecatedErrorCustomization, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags safeParseAsync errorMap options on direct schema chains", () => {
    const code = `
      import { z } from "zod";
      await z.string().safeParseAsync(value, { errorMap: () => ({ message: "Bad" }) });
    `;
    const result = runRule(zodV4NoDeprecatedErrorCustomization, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag Zod 4 unified error customization", () => {
    const code = `
      import { z } from "zod";
      const schema = z.string({ error: "Required" });
    `;
    const result = runRule(zodV4NoDeprecatedErrorCustomization, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT treat literal and enum string values as legacy message parameters", () => {
    const code = `
      import { z } from "zod";
      const status = z.literal("draft");
      const format = z.union([z.literal("csv"), z.literal("xlsx")]);
      const plan = z.enum(["pro", "scale"]);
    `;
    const result = runRule(zodV4NoDeprecatedErrorCustomization, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT treat first string arguments on non-message factories as messages", () => {
    const code = `
      import { z } from "zod";
      const record = z.record(z.string(), z.unknown());
      const map = z.map(z.string(), z.number());
      const set = z.set(z.string());
    `;
    const result = runRule(zodV4NoDeprecatedErrorCustomization, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag non-Zod lookalikes", () => {
    const code = `
      const z = createValidator();
      const schema = z.string("Required");
    `;
    const result = runRule(zodV4NoDeprecatedErrorCustomization, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag type-flow aliases of schemas in v1", () => {
    const code = `
      import { z } from "zod";
      const schema = z.string();
      schema.parse(value, { errorMap: () => ({ message: "Bad" }) });
    `;
    const result = runRule(zodV4NoDeprecatedErrorCustomization, code);
    expect(result.diagnostics).toHaveLength(0);
  });
});
