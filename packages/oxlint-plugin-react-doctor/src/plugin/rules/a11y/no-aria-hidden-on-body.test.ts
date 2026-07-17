import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAriaHiddenOnBody } from "./no-aria-hidden-on-body.js";

describe("no-aria-hidden-on-body", () => {
  it("reports a statically hidden body", () => {
    expect(
      runRule(noAriaHiddenOnBody, `const Page = () => <body aria-hidden="true" />;`).diagnostics,
    ).toHaveLength(1);
  });

  it("accepts false and dynamic values", () => {
    const result = runRule(
      noAriaHiddenOnBody,
      `const Page = ({ hidden }) => <><body aria-hidden={false} /><body aria-hidden={hidden} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
