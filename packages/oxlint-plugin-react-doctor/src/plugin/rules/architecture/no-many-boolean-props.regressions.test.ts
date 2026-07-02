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

  it("does not count `props.show*` wired as JSX event handlers", () => {
    const result = run(
      `function Toolbar(props){ return <div onClick={props.showMenu} onMouseDown={props.hideMenu} onKeyDown={props.enableSave} onFocus={props.disableSave} />; }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags four genuine boolean props read off the props object", () => {
    const result = run(
      `function C(props){ return <div data-a={props.isPrimary} data-b={props.hasIcon} data-c={props.showHeader} data-d={props.canEdit} />; }`,
    );
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // fp-review PR 996: the render-output gate treated nested arrow callbacks
  // as boundaries, skipping components whose JSX lives only inside
  // `.map`/`useMemo` callbacks.
  it("flags a component that renders only via a .map callback", () => {
    const result = run(
      `function List({ showHeader, showFooter, isCompact, hasBorder, items }){
        return items.map((item) => <li key={item}>{item}</li>);
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a component that returns JSX from a useMemo callback", () => {
    const result = run(
      `import { useMemo } from "react";
      function Panel({ isOpen, isLoading, hasIcon, canEdit }){
        return useMemo(() => <div data-open={isOpen} data-loading={isLoading} data-icon={hasIcon} data-edit={canEdit} />, [isOpen, isLoading, hasIcon, canEdit]);
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a props-object component that renders only via a .map callback", () => {
    const result = run(
      `function List(props){
        return props.items.map((item) => <li data-a={props.showHeader} data-b={props.showFooter} data-c={props.isCompact} data-d={props.hasBorder} key={item}>{item}</li>);
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent on a non-component factory with zero JSX anywhere", () => {
    const result = run(
      `function CreateValidator(options){
        const check = () => options.isStrict && options.hasSchema;
        return { check, isEnabled: options.isEnabled, showErrors: options.showErrors };
      }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  // fp-review PR 996: renamed destructured callbacks (`{ showMenu: openMenu }`)
  // must match the exclusion via the VALUE binding name.
  it("does not count renamed destructured callback props", () => {
    const result = run(
      `function Toolbar({ showMenu: openMenu, hideMenu: closeMenu, enableSave: turnOn, disableSave: turnOff }){
        return <div onClick={openMenu}>{closeMenu()}{turnOn()}{turnOff()}</div>;
      }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  // fp-review PR 996: imperative-prefixed props passed as call ARGUMENTS
  // (setTimeout/debounce/subscription wiring) are callbacks too.
  it("does not count `props.show*` passed as a callback argument", () => {
    const result = run(
      `function Toolbar(props){
        return <div onClick={() => { setTimeout(props.showMenu, 100); setTimeout(props.hideMenu, 100); register(props.enableSave); register(props.disableSave); }} />;
      }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not count destructured imperative names passed as callback arguments", () => {
    const result = run(
      `function Toolbar({ showMenu, hideMenu, enableSave, disableSave }){
        return <div onClick={() => { setTimeout(showMenu, 100); setTimeout(hideMenu, 100); register(enableSave); register(disableSave); }} />;
      }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still counts non-imperative boolean props passed as call arguments (classNames)", () => {
    const result = run(
      `function Badge(props){
        return <div className={classNames(props.isActive, props.isPrimary, props.hasIcon, props.isCompact)} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  // fp-review PR 996: the callback exclusion must resolve to the component's
  // own props binding — a shadowed inner parameter sharing a prop's name
  // must not drop the genuine boolean prop from the count.
  it("still flags when a nested shadowed function parameter shares a prop's name", () => {
    const result = run(
      `function Panel({ isOpen, isLoading, hasIcon, canEdit }){
        const helper = (canEdit) => canEdit();
        return <div data-open={isOpen} data-loading={isLoading} data-icon={hasIcon} data-edit={canEdit} onClick={() => helper(() => true)} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
