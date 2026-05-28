import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { controlHasAssociatedLabel } from "./control-has-associated-label.js";

describe("a11y/control-has-associated-label regressions", () => {
  it("accepts a control nested inside a label with sibling text", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        const Demo = ({ texts, sf }) => (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="spelformer" value={sf} />
            <span>{texts.spelform[sf]}</span>
          </label>
        );
      `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("accepts matching htmlFor and id JSX identifier expressions", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        const Demo = ({ texts }) => {
          const tomDatumId = useId() + "-tom";

          return (
            <div>
              <label htmlFor={tomDatumId} className="text-sm font-medium">
                {texts.tomDatumLabel}
              </label>
              <input id={tomDatumId} name="tom_datum" type="date" />
            </div>
          );
        };
      `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("accepts component-internal htmlFor and id prop pairs", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        const BeloppField = ({ id, name, label }) => (
          <div>
            <label htmlFor={id}>{label}</label>
            <input id={id} name={name} type="number" />
          </div>
        );

        const Demo = ({ texts }) => (
          <BeloppField id="ersattning_5v5" name="ersattning_5v5" label={texts.label5v5} />
        );
      `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not treat labels inside callback props as rendered labels", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        const Demo = () => {
          const fieldId = "amount";

          return (
            <div>
              <FieldShell renderLabel={() => <label htmlFor={fieldId}>Amount</label>} />
              <input id={fieldId} name="amount" type="number" />
            </div>
          );
        };
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat ancestor labels across render-prop boundaries as associations", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        const Demo = () => (
          <label>
            Some text
            <Component render={() => <input type="text" />} />
          </label>
        );
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts htmlFor/id pairs inside conditional rendering", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        const Demo = ({ showField }) => (
          <div>
            {showField && (
              <>
                <label htmlFor="amount">Amount</label>
                <input id="amount" name="amount" type="number" />
              </>
            )}
          </div>
        );
      `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("accepts htmlFor/id pairs inside ternary expressions", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        const Demo = ({ variant }) => (
          <div>
            {variant === "a"
              ? <>
                  <label htmlFor="fieldA">Field A</label>
                  <input id="fieldA" type="text" />
                </>
              : <>
                  <label htmlFor="fieldB">Field B</label>
                  <input id="fieldB" type="text" />
                </>
            }
          </div>
        );
      `,
    );

    expect(result.diagnostics).toEqual([]);
  });
});
