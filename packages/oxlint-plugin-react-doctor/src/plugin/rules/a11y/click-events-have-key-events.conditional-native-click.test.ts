import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { clickEventsHaveKeyEvents } from "./click-events-have-key-events.js";

const settings = { "react-doctor": { portedRuleMode: "curated" } };
const choice = `
export function Choice({ enabled = false, checked = false, chooseValue, translate, otherGate, getGate }) {
  const choose = (event) => {
    event.stopPropagation();
    chooseValue?.(!checked);
  };
  return (
    <div
      className={\`choice-card relative flex w-full overflow-hidden hover:shadow-sm \${enabled ? "cursor-pointer" : ""} \${enabled && checked ? "ring-2" : ""}\`}
      onClick={enabled ? choose : undefined}
    >
      {enabled && <button
                    type="button"
                    onClick={choose}
                    className={\`absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border \${checked ? "bg-neutral-600 text-white border-neutral-600" : "bg-white/90 text-transparent border-neutral-300 dark:bg-neutral-800/90"} shadow-sm\`}
                    title={checked ? translate("Clear") : translate("Choose")}
                  >
                    <svg aria-hidden="true" />
                  </button>}
      <span>Details</span>
    </div>
  );
}
`;
const variant = (previous: string, next: string): string => choice.replace(previous, next);

describe("conditional native keyboard click alternatives", () => {
  it("recognizes the same conditional action without imposing a second label check", () => {
    expect(runRule(clickEventsHaveKeyEvents, choice, { settings }).diagnostics).toEqual([]);
    const unnamed = variant('title={checked ? translate("Clear") : translate("Choose")}', "");
    expect(runRule(clickEventsHaveKeyEvents, unnamed, { settings }).diagnostics).toEqual([]);
    expect(
      runRule(clickEventsHaveKeyEvents, choice, {
        settings: { "react-doctor": { portedRuleMode: "upstream" } },
      }).diagnostics,
    ).toHaveLength(1);
  });

  it.each([
    ["enabled && <button", "otherGate && <button"],
    ["enabled && <button", "!enabled && <button"],
    ["enabled && <button", "getGate()}\n      {enabled && <button"],
    ["onClick={choose}", "onClick={() => chooseValue?.(checked)}"],
    ["chooseValue?.(!checked)", "chooseValue?.(event.currentTarget)"],
    ['type="button"', 'type="button" disabled'],
    ['type="button"', 'type="button" inert'],
    ['type="button"', 'type="button" hidden'],
    ['type="button"', 'type="button" tabIndex={-1}'],
    ["bg-neutral-600", "dark:hidden"],
    ["choice-card relative", "choice-card [&>button]:hidden relative"],
    ["bg-neutral-600", "possibly-hidden"],
    ['type="button"', 'type="button" {...getGate()}'],
    ["onClick={enabled", "onClickCapture={enabled"],
  ])("keeps the warning when %s becomes %s", (previous, next) => {
    const result = runRule(clickEventsHaveKeyEvents, variant(previous, next), { settings });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    '<><style>{"button { display: none }"}</style><Choice /></>',
    '<><div dangerouslySetInnerHTML={{ __html: "<style>button { display: none }</style>" }} /><Choice /></>',
    "<fieldset disabled><Choice /></fieldset>",
    "<section inert><Choice /></section>",
    "<section onKeyDownCapture={event => event.preventDefault()}><Choice /></section>",
    "<section onKeyDown={event => event.preventDefault()}><Choice /></section>",
    '<section onClickCapture={event => { if (event.target.closest("button")) event.stopPropagation(); }} onKeyUp={() => {}}><Choice /></section>',
    "<fieldset {...props}><Choice /></fieldset>",
  ])("keeps the warning when a same-file rendering may block the button", (caller) => {
    const result = runRule(
      clickEventsHaveKeyEvents,
      `${choice}\nexport const Scene = (props) => (${caller});`,
      { settings },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores explicitly inactive wrapper props and closed unrelated spreads", () => {
    const source = `${choice}
      export const Scene = () => (
        <fieldset disabled={false}>
          <section inert={false} onClickCapture={null}>
            <Choice {...{ "data-demo": true }} />
          </section>
        </fieldset>
      );`;
    const result = runRule(clickEventsHaveKeyEvents, source, { settings, includeLocations: true });
    expect(result.parseErrors).toEqual([]);
    const wrapper =
      source.split("\n").findIndex((line) => line.includes("onClickCapture={null}")) + 1;
    expect(result.diagnostics.map((diagnostic) => diagnostic.line)).toEqual([wrapper]);
  });
});
