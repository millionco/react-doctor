import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noManyBooleanProps } from "./no-many-boolean-props.js";

const run = (code: string) => runRule(noManyBooleanProps, code, { filename: "fixture.tsx" });

describe("architecture/no-many-boolean-props — regressions", () => {
  it("does not count boolean-prefixed props that are imperative callbacks", () => {
    const result = run(
      `function Toolbar({ showMenu, hideMenu, enableSave, disableSave }){ return <div onClick={showMenu}>{hideMenu()}{enableSave()}{disableSave()}</div>; }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags four genuine on/off boolean props", () => {
    const result = run(
      `function C({ isPrimary, hasIcon, showHeader, canEdit }){ return <div />; }`,
    );
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
