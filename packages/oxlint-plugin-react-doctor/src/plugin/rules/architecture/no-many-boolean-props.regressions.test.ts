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

  // Bugbot wave 4: the callback exclusion must also apply to the `props` object
  // shape — `props.showMenu()` is an invoked callback, not a boolean prop.
  it("does not count `props.show*()` callback invocations on the props object", () => {
    const result = run(
      `function Toolbar(props){ return <div onClick={props.showMenu}>{props.hideMenu()}{props.enableSave()}{props.disableSave()}</div>; }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags four genuine boolean props read off the props object", () => {
    const result = run(
      `function C(props){ return <div data-a={props.isPrimary} data-b={props.hasIcon} data-c={props.showHeader} data-d={props.canEdit} />; }`,
    );
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
