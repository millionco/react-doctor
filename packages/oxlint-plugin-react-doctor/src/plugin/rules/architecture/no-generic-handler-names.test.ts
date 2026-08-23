import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noGenericHandlerNames } from "./no-generic-handler-names.js";

describe("no-generic-handler-names", () => {
  it("flags a handler that mirrors the event name", () => {
    const result = runRule(
      noGenericHandlerNames,
      `const button = <button onClick={handleClick}>Save</button>;`,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows an action-specific handler name", () => {
    const result = runRule(
      noGenericHandlerNames,
      `const button = <button onClick={saveProfile}>Save</button>;`,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows a matching handler name on an unrelated prop", () => {
    const result = runRule(
      noGenericHandlerNames,
      `const button = <Widget afterClick={handleClick} />;`,
    );

    expect(result.diagnostics).toHaveLength(0);
  });
});
