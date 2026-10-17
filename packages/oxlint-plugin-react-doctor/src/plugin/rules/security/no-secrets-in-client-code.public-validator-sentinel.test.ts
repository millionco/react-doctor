import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSecretsInClientCode } from "./no-secrets-in-client-code.js";

describe("security/no-secrets-in-client-code public validator marker", () => {
  it("canonical public validator marker", () => {
    const result = runRule(
      noSecretsInClientCode,
      '"use client";\nexport const ReactPropTypesSecret = "SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED";\n',
      { filename: "src/components/validator.tsx" },
    );
    expect(result.parseErrors).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("bundler renamed public validator marker", () => {
    const result = runRule(
      noSecretsInClientCode,
      '"use client";\nexport const ReactPropTypesSecret$2 = "SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED";\n',
      { filename: "src/components/validator.tsx" },
    );
    expect(result.parseErrors).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("public marker under unrelated secret binding", () => {
    const result = runRule(
      noSecretsInClientCode,
      '"use client";\nexport const credentialValue = "SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED";\n',
      { filename: "src/components/validator.tsx" },
    );
    expect(result.parseErrors).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("mutable declaration still holds public literal", () => {
    const result = runRule(
      noSecretsInClientCode,
      '"use client";\nexport let validationSecret = "SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED";\n',
      { filename: "src/components/validator.tsx" },
    );
    expect(result.parseErrors).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("public marker function local", () => {
    const result = runRule(
      noSecretsInClientCode,
      '"use client";\nexport const readValidationMarker = () => { const credentialValue = "SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED"; return credentialValue; };\n',
      { filename: "src/components/validator.tsx" },
    );
    expect(result.parseErrors).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("decoded public literal escape", () => {
    const result = runRule(
      noSecretsInClientCode,
      '"use client";\nexport const credentialValue = "\\u0053ECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED";\n',
      { filename: "src/components/validator.tsx" },
    );
    expect(result.parseErrors).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("exact marker does not hide next declaration", () => {
    const result = runRule(
      noSecretsInClientCode,
      '"use client";\nexport const credentialValue = "SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED"; export const signingSecret = "9Az6Vm1Qe8Kt4Bn7Xs2Pr5Ld0Cy3Hw9F";\n',
      { filename: "src/components/validator.tsx" },
    );
    expect(result.parseErrors).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("suffix mutation remains heuristic finding", () => {
    const result = runRule(
      noSecretsInClientCode,
      '"use client";\nexport const credentialValue = "SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED_9Az6";\n',
      { filename: "src/components/validator.tsx" },
    );
    expect(result.parseErrors).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("prefix mutation remains heuristic finding", () => {
    const result = runRule(
      noSecretsInClientCode,
      '"use client";\nexport const credentialValue = "9Az6_SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED";\n',
      { filename: "src/components/validator.tsx" },
    );
    expect(result.parseErrors).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("padded marker remains outside exact exception", () => {
    const result = runRule(
      noSecretsInClientCode,
      '"use client";\nexport const credentialValue = " SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED ";\n',
      { filename: "src/components/validator.tsx" },
    );
    expect(result.parseErrors).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("unrelated uppercase marker remains finding", () => {
    const result = runRule(
      noSecretsInClientCode,
      '"use client";\nexport const credentialValue = "PRIVATE_VALIDATOR_INTERNAL_ACCESS_SENTINEL";\n',
      { filename: "src/components/validator.tsx" },
    );
    expect(result.parseErrors).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("named validator does not hide credential prefix", () => {
    const result = runRule(
      noSecretsInClientCode,
      '"use client";\nexport const ReactPropTypesSecret = "github_pat_SyntheticValidatorControl000001";\n',
      { filename: "src/components/validator.tsx" },
    );
    expect(result.parseErrors).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("named validator does not hide unknown long value", () => {
    const result = runRule(
      noSecretsInClientCode,
      '"use client";\nexport const ReactPropTypesSecret = "9Az6Vm1Qe8Kt4Bn7Xs2Pr5Ld0Cy3Hw9F";\n',
      { filename: "src/components/validator.tsx" },
    );
    expect(result.parseErrors).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("credential prefix before public marker remains finding", () => {
    const result = runRule(
      noSecretsInClientCode,
      '"use client";\nexport const validationSecret = "sk_live_SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED";\n',
      { filename: "src/components/validator.tsx" },
    );
    expect(result.parseErrors).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("unrelated nonsecret binding retains quiet", () => {
    const result = runRule(
      noSecretsInClientCode,
      '"use client";\nexport const selectedLabel = "9Az6Vm1Qe8Kt4Bn7Xs2Pr5Ld0Cy3Hw9F";\n',
      { filename: "src/components/validator.tsx" },
    );
    expect(result.parseErrors).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("public marker server profile retains quiet", () => {
    const result = runRule(
      noSecretsInClientCode,
      'export const credentialValue = "SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED";\n',
      { filename: "src/validator.server.ts" },
    );
    expect(result.parseErrors).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("existing identifier key exception retained", () => {
    const result = runRule(
      noSecretsInClientCode,
      '"use client";\nexport const credentialValue = "validation.publicMarker.selectedValue";\n',
      { filename: "src/components/validator.tsx" },
    );
    expect(result.parseErrors).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("existing template syntax remains unexpanded", () => {
    const result = runRule(
      noSecretsInClientCode,
      '"use client";\nexport const credentialValue = `SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED`;\n',
      { filename: "src/components/validator.tsx" },
    );
    expect(result.parseErrors).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("existing object property syntax remains unexpanded", () => {
    const result = runRule(
      noSecretsInClientCode,
      '"use client";\nexport const settings = { credentialValue: "SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED" };\n',
      { filename: "src/components/validator.tsx" },
    );
    expect(result.parseErrors).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("wrapped literal syntax remains legacy quiet", () => {
    const result = runRule(
      noSecretsInClientCode,
      '"use client";\nexport const credentialValue = ("SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED" as const);\n',
      { filename: "src/components/validator.tsx" },
    );
    expect(result.parseErrors).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);
  });
});
