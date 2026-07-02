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

  it("accepts a display-none file input wired to a ref (programmatic trigger)", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        const Demo = ({ fileInputRef, onChange }) => (
          <div>
            <input ref={fileInputRef} type="file" className="hidden" onChange={onChange} />
            <button type="button" onClick={() => fileInputRef.current?.click()}>Upload avatar</button>
          </div>
        );
      `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("reports a display-none file input without a ref (no programmatic trigger)", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `const Demo = () => <input type="file" className="hidden" />;`,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports an sr-only file input even with a ref (still focusable, so it needs a name)", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        const Demo = ({ inputRef }) => (
          <input ref={inputRef} type="file" className="sr-only" />
        );
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a ref-wired file input with an expression-container string className", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        const Demo = ({ fileInputRef }) => (
          <input ref={fileInputRef} type="file" className={"hidden"} />
        );
      `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("accepts a ref-wired file input with a static template-literal className", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        const Demo = ({ fileInputRef }) => (
          <input ref={fileInputRef} type="file" className={\`hidden\`} />
        );
      `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("accepts a ref-wired file input with a multi-quasi template className containing a whitespace-bounded hidden token", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        const Demo = ({ fileInputRef, extraClasses }) => (
          <input ref={fileInputRef} type="file" className={\`hidden \${extraClasses}\`} />
        );
      `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("reports a ref-wired file input whose template className only partially spells hidden across an expression", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        const Demo = ({ fileInputRef, prefix }) => (
          <input ref={fileInputRef} type="file" className={\`\${prefix}hidden\`} />
        );
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("skips the mined role=tab theme swatch inside a .dumi docs page", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        const ThemePreview = ({ selected, styles, onSelect, onKeyDown, title }) => (
          <Tooltip title={title}>
            <div
              role="tab"
              tabIndex={0}
              aria-selected={selected}
              onClick={onSelect}
              onKeyDown={onKeyDown}
              className={styles.themeBlock}
            />
          </Tooltip>
        );
      `,
      { filename: "/repo/.dumi/pages/index/components/ThemePreview/index.tsx" },
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("still reports the unlabeled role=tab swatch in production source", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        const ThemePreview = ({ selected, styles, onSelect, onKeyDown, title }) => (
          <Tooltip title={title}>
            <div
              role="tab"
              tabIndex={0}
              aria-selected={selected}
              onClick={onSelect}
              onKeyDown={onKeyDown}
              className={styles.themeBlock}
            />
          </Tooltip>
        );
      `,
      { filename: "/repo/src/components/theme-preview.tsx" },
    );

    expect(result.diagnostics).toHaveLength(1);
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
