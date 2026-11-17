import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { clickEventsHaveKeyEvents } from "./click-events-have-key-events.js";

describe("a11y/click-events-have-key-events effective handlers", () => {
  it("reports only effective click handlers without effective keyboard handlers", () => {
    const result = runRule(
      clickEventsHaveKeyEvents,
      `const action = () => activate();
      <div onClick={null} />;
      <div onClick={action} onKeyDown={null} />;
      <div onClick={undefined} />;
      <div onClick={action} onKeyDown={undefined} />;
      <div onClick={action} />;
      <div onClick={action} onKeyDown={action} />;
      <div onClick={null} {...{ onClick: action }} />;
      <div {...{ onClick: action }} onClick={null} />;
      <div onClick={action} {...{ onKeyDown: action }} onKeyDown={null} />;
      <div onClick={action} onKeyDown={null} {...{ onKeyDown: action }} />;`,
      { includeLocations: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.line)).toEqual([3, 5, 6, 8, 10]);
  });

  it("handles nested spreads and preserves independent click phases", () => {
    const result = runRule(
      clickEventsHaveKeyEvents,
      `const base = { onClick: activate, onKeyDownCapture: handleKey };
      const alias = base;
      <div {...{ ...alias, ["onKeyDownCapture"]: void 0 }} />;
      <div {...{ ...alias, ["onClick"]: void 0 }} />;
      <div onClick={null} onClickCapture={activate} />;
      <div onClick={activate} onClickCapture={null} />;
      <div onClick={activate} onClickCapture={(event) => event.preventDefault()} />;
      <div onClick={activate} onClickCapture={null} onKeyUpCapture={handleKey} />;`,
      { includeLocations: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.line)).toEqual([3, 5, 6, 7]);
  });

  it("does not treat bound undefined or differently spelled props as nullish overrides", () => {
    const result = runRule(
      clickEventsHaveKeyEvents,
      `const Click = (undefined) => <div onClick={undefined} />;
      const Key = (undefined) => <div onClick={activate} onKeyDown={undefined} />;
      const SpreadClick = (undefined) => <div {...{ onClick: undefined }} />;
      <div onClick={activate} {...{ onclick: null }} />;
      <div onClick={activate} onKeyDown={handleKey} {...{ onkeydown: null }} />;
      <div onClick={(event) => event.preventDefault()} ONCLICK={activate} />;
      <div onClick={null} ONCLICK={activate} />;
      <div ONCLICK={activate} />;
      <div onClick={activate} onKeyDown={null} ONKEYDOWN={handleKey} />;`,
      { includeLocations: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.line)).toEqual([1, 3, 4, 8, 9]);
  });

  it("requires a descendant's click to reach a bubbling handler even when capture is set", () => {
    const result = runRule(
      clickEventsHaveKeyEvents,
      `<div onClick={activate} onClickCapture={null}><button onClick={(event) => event.stopPropagation()}>Open</button></div>;
      <div onClickCapture={activate}><button onClick={(event) => event.stopPropagation()}>Open</button></div>;
      <div onClick={activate} onClickCapture={(event) => event.preventDefault()}><button onClick={(event) => event.stopPropagation()}>Open</button></div>;`,
      { includeLocations: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.line)).toEqual([1, 3]);
  });

  it("keeps opaque spreads, getters, and mutated props conservative", () => {
    const result = runRule(
      clickEventsHaveKeyEvents,
      `const Opaque = (props) => <div onClick={activate} {...props} onKeyDown={null} />;
      <div onClick={activate} {...{ get onKeyDown() { return handleKey; } }} />;
      <div onClick={activate} {...{ get label() { return "Open"; }, onKeyDown: null }} />;
      const original = { onKeyDown: null };
      const alias = original;
      alias.onKeyDown = handleKey;
      <div onClick={activate} {...original} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
