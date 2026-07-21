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

  it("skips controls passed through JSX attribute values (composition is unknowable)", () => {
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

    expect(result.diagnostics).toHaveLength(0);
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

  it("reports a ref-wired file input whose arbitrary value contains a hidden fragment", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `const Demo = ({ fileInputRef }) => <input ref={fileInputRef} type="file" className="[--state:x hidden y]" />;`,
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

  it("skips skeleton table cells (empty and pulsing-placeholder td/th)", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        const TableSkeleton = ({ rows, columns }) => (
          <table>
            <thead>
              <tr>
                <th scope="col" className="px-6 py-3">
                  <div className="h-6 w-24 animate-pulse rounded" />
                </th>
                <th className="pb-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="px-6 py-4">
                  <div className="h-5 rounded animate-pulse" />
                </td>
              </tr>
            </tbody>
          </table>
        );
      `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("still reports a table cell that opts into a widget role", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `const Demo = ({ onSort }) => <td role="button" onClick={onSort} />;`,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("skips inputs hidden with an inline display:none style", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        const Demo = ({ fileInputRef, onChange }) => (
          <div>
            <input type="file" style={{ display: "none" }} ref={fileInputRef} onChange={onChange} />
            <textarea style={{ display: "none" }} value="mirror" readOnly />
          </div>
        );
      `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("skips submit-proxy inputs carrying the hidden attribute", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `const Demo = ({ formRef }) => <input type="submit" hidden ref={formRef} />;`,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("skips controls inside an aria-hidden or hidden ancestor", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        const Demo = ({ values }) => (
          <div hidden aria-hidden="true">
            {values.map((value) => (
              <input key={value} type="checkbox" checked readOnly />
            ))}
          </div>
        );
      `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("accepts native controls named by their own title attribute", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        const Demo = ({ t, color }) => (
          <div>
            <input type="color" title={t("sketch.color")} />
            <input type="text" title="Search" />
            <input type="checkbox" title="Select row" />
            <select title="Sort order" />
            <textarea title="Comment" />
            <button type="button" title={color.label} onClick={() => {}} />
            <div role="button" tabIndex={0} title="Edit" />
          </div>
        );
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts an icon-only delete button carrying a static title", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        import { Trash2 } from 'lucide-react';

        const ListRow = ({ onDelete, idx, disabled }) => (
          <button
            type="button"
            onClick={() => onDelete(idx)}
            disabled={disabled}
            title="Remove row"
            className="shrink-0 text-gray-500"
          >
            <Trash2 size={12} />
          </button>
        );
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts an icon-only toggle button with a dynamic title", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

        const ConversationList = ({ isExpanded, setIsExpanded, t }) => (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 rounded-md"
            title={isExpanded ? t.conversationList.collapseList : t.conversationList.expandList}
          >
            {isExpanded ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          </button>
        );
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a conditionally rendered title-only delete button", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        import { Trash2 } from 'lucide-react';

        const MediaCollections = ({ collections, handleDelete }) => (
          <div>
            {collections.map((c) => (
              <div key={c.id}>
                {!c.synthetic && (
                  <button
                    type="button"
                    onClick={() => handleDelete(c)}
                    className="px-1.5 py-1 rounded flex items-center gap-1"
                    title="Delete collection"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        );
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a title-only close button behind a logical guard", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        import { X } from "lucide-react";

        const SplitEditor = ({ onClose, t }) => (
          <div className="h-9 flex items-center px-3 justify-between">
            {onClose && (
              <button
                onClick={onClose}
                className="p-1 rounded transition-colors"
                title={t.layout.closePanel}
              >
                <X size={14} />
              </button>
            )}
          </div>
        );
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("still reports a button whose only title lives on a child span", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `const Demo = () => <button><span title="This is not a real label" /></button>;`,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports native buttons whose title is statically omitted or empty", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        const Demo = () => (
          <div>
            <button title=""><svg aria-hidden /></button>
            <button title={"   "}><svg aria-hidden /></button>
            <button title={null}><svg aria-hidden /></button>
            <button title={false}><svg aria-hidden /></button>
            <button title={true}><svg aria-hidden /></button>
            <button title={undefined}><svg aria-hidden /></button>
            <button title={void 0}><svg aria-hidden /></button>
            <button title={() => "Edit"}><svg aria-hidden /></button>
            <button title={class Title {}}><svg aria-hidden /></button>
            <button title={Symbol("Edit")}><svg aria-hidden /></button>
            <button title={[]}><svg aria-hidden /></button>
            <button title={[""]}><svg aria-hidden /></button>
            <button title={[null]}><svg aria-hidden /></button>
            <button title><svg aria-hidden /></button>
            <button><svg aria-hidden /></button>
          </div>
        );
      `,
    );

    expect(result.diagnostics).toHaveLength(15);
  });

  it("accepts native title names through DOM string coercion and unresolved expressions", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        const STATIC_TITLE = "Ask AI";
        const Demo = ({ translatedTitle, isEditing }) => (
          <div>
            <button title={STATIC_TITLE}><svg aria-hidden /></button>
            <button title={translatedTitle}><svg aria-hidden /></button>
            <button title={isEditing ? "Save" : "Edit"}><svg aria-hidden /></button>
            <button title={\`Ask AI\`}><svg aria-hidden /></button>
            <button title={0}><svg aria-hidden /></button>
            <button title={0n}><svg aria-hidden /></button>
            <button title={{}}><svg aria-hidden /></button>
            <button title={[0]}><svg aria-hidden /></button>
            <button title={[null, null]}><svg aria-hidden /></button>
          </div>
        );
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("uses the last duplicate title attribute, matching React", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        const Demo = () => (
          <div>
            <button title="Edit" title=""><svg aria-hidden /></button>
            <button title="" title="Edit"><svg aria-hidden /></button>
          </div>
        );
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports title expressions with a statically unnamed branch", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        const Demo = ({ isEditing }) => (
          <div>
            <button title={isEditing ? "Save" : ""}><svg aria-hidden /></button>
            <button title={isEditing ? null : "Edit"}><svg aria-hidden /></button>
            <button title={isEditing && "Edit"}><svg aria-hidden /></button>
            <button title={!isEditing}><svg aria-hidden /></button>
          </div>
        );
      `,
    );

    expect(result.diagnostics).toHaveLength(4);
  });

  it("follows static logical title values through React DOM coercion", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        const Demo = () => (
          <div>
            <button title={0 && "Edit"}><svg aria-hidden /></button>
            <button title={0n && "Edit"}><svg aria-hidden /></button>
            <button title={false && "Edit"}><svg aria-hidden /></button>
            <button title={null && "Edit"}><svg aria-hidden /></button>
            <button title={"" && "Edit"}><svg aria-hidden /></button>
            <button title={true && "Edit"}><svg aria-hidden /></button>
            <button title={true && ""}><svg aria-hidden /></button>
            <button title={false || "Edit"}><svg aria-hidden /></button>
            <button title={true || "Edit"}><svg aria-hidden /></button>
            <button title={0 || "Edit"}><svg aria-hidden /></button>
            <button title={null ?? "Edit"}><svg aria-hidden /></button>
            <button title={false ?? "Edit"}><svg aria-hidden /></button>
            <button title={0 ?? ""}><svg aria-hidden /></button>
            <button title={(console.log("render"), "")}><svg aria-hidden /></button>
            <button title={(console.log("render"), "Edit")}><svg aria-hidden /></button>
          </div>
        );
      `,
    );

    expect(result.diagnostics).toHaveLength(7);
  });

  it("handles transparent TypeScript wrappers around title values", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        const Demo = ({ label }: { label: string }) => (
          <div>
            <button title={("Edit" as string)!}><svg aria-hidden /></button>
            <button title={((label satisfies string))}><svg aria-hidden /></button>
            <button title={("" as string)!}><svg aria-hidden /></button>
            <button title={(null as string | null)}><svg aria-hidden /></button>
          </div>
        );
      `,
    );

    expect(result.diagnostics).toHaveLength(2);
  });

  it("keeps a shadowed undefined title conservative", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `const Demo = ({ undefined }) => <button title={undefined}><svg aria-hidden /></button>;`,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a title fallback on a native element with an interactive role", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `const Demo = ({ onActivate }) => <div role="button" tabIndex={0} title="Edit" onClick={onActivate} />;`,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not assume that title names an opaque configured control component", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `const Demo = () => <IconButton title="Edit" />;`,
      {
        settings: {
          "react-doctor": {
            controlHasAssociatedLabel: { controlComponents: ["IconButton"] },
          },
        },
      },
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps JSX spreads conservative regardless of title ordering", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        const Demo = ({ props }) => (
          <div>
            <button title="Edit" {...props}><svg aria-hidden /></button>
            <button {...props} title="Edit"><svg aria-hidden /></button>
            <button title="" {...props}><svg aria-hidden /></button>
            <button {...props} title=""><svg aria-hidden /></button>
          </div>
        );
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not apply React title semantics to Solid-owned JSX", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        import { createSignal } from "solid-js";
        const Demo = () => {
          const [label] = createSignal("Edit");
          return <button title={label()}><svg aria-hidden /></button>;
        };
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not let a nested title-only control label its native parent", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        const Demo = () => (
          <button>
            <button title="Edit"><svg aria-hidden /></button>
          </button>
        );
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("skips media elements (passive previews and self-labelled native controls)", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        const Demo = ({ src }) => (
          <div>
            <video src={src} muted autoPlay loop />
            <audio controls src={src} />
          </div>
        );
      `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("skips value-only options inside a datalist", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        const Demo = ({ folders }) => (
          <datalist id="folders">
            {folders.map((folder) => (
              <option key={folder} value={folder} />
            ))}
          </datalist>
        );
      `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("skips submit and reset inputs (user-agent default names)", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        const Demo = () => (
          <form>
            <input type="submit" value="Send" />
            <input type="submit" />
            <input type="reset" />
          </form>
        );
      `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("accepts text inputs named by their placeholder fallback", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `const Demo = ({ onSearch }) => <input placeholder="Search models..." onChange={onSearch} />;`,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("skips non-focusable role=separator dividers but reports focusable ones", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        const Demo = ({ onResize }) => (
          <div>
            <li role="separator" />
            <div role="separator" tabIndex={0} onMouseDown={onResize} />
          </div>
        );
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts matching dynamic template-literal htmlFor/id pairs", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        const BucketCard = ({ bucket, form, setForm }) => (
          <div>
            <label htmlFor={\`bucket-name-\${bucket.id}\`} className="sr-only">Bucket name</label>
            <input
              id={\`bucket-name-\${bucket.id}\`}
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
        );
      `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("accepts controls associated with a label rendered by a sibling component in the same file", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        const ControlRow = ({ name, children }) => (
          <div>
            <label htmlFor={\`pg-\${name}\`}>{name}</label>
            {children}
          </div>
        );

        const RangeControl = ({ name, value, onChange }) => (
          <ControlRow name={name}>
            <input id={\`pg-\${name}\`} type="range" value={value} onChange={onChange} />
          </ControlRow>
        );
      `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("accepts controls wrapped by a field component carrying a label prop", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        const Demo = ({ cfg, patch }) => (
          <Field label="Hotkey" hint="Hold to talk (keyboard).">
            <input type="text" value={cfg.hotkey} onChange={(e) => patch("hotkey", e.target.value)} />
          </Field>
        );
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("still reports a control inside a field component whose label prop is empty", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        const Demo = ({ cfg }) => (
          <Field label="">
            <input type="text" value={cfg.hotkey} />
          </Field>
        );
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts controls wrapped in a text-bearing Label design-system component", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        const Demo = ({ checked, onChange }) => (
          <Label className="flex items-center gap-2">
            <input type="radio" checked={checked} onChange={onChange} />
            First lines
          </Label>
        );
      `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("accepts a file input inside a polymorphic component=label button with text", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        const Demo = ({ onUpload }) => (
          <Button component="label">
            Upload File
            <input type="file" onChange={onUpload} />
          </Button>
        );
      `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("accepts controls emitted by a render helper invoked inside a text-bearing label", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        const PluginInputsForm = ({ fields }) => {
          const renderField = (field) => {
            if (field.kind === "checkbox") {
              return <input type="checkbox" checked={field.value} />;
            }
            return <input type="text" value={field.value} />;
          };

          return fields.map((field) => (
            <label key={field.name}>
              <span>{field.title}</span>
              {renderField(field)}
            </label>
          ));
        };
      `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("reports an unlabeled select whose only text is option content", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        const Demo = ({ range, setRange }) => (
          <select value={range} onChange={(e) => setRange(e.target.value)}>
            <option value="7">7 days</option>
            <option value="14">14 days</option>
          </select>
        );
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a select with an aria-label, wrapping label, or matching htmlFor", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        const Demo = ({ options }) => (
          <div>
            <select aria-label="Days">{options}</select>
            <label>
              Days
              <select>{options}</select>
            </label>
            <label htmlFor="days">Days</label>
            <select id="days">{options}</select>
          </div>
        );
      `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("reports icon-only buttons whose children come from an icon package", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        import { X, Pencil, Trash2 } from "lucide-react";

        const Demo = ({ onClose, onEdit, onDelete }) => (
          <div>
            <button onClick={onClose}><X className="h-4 w-4" /></button>
            <button onClick={onEdit}><Pencil size={14} /></button>
            <button onClick={onDelete}><Trash2 /></button>
          </div>
        );
      `,
    );

    expect(result.diagnostics).toHaveLength(3);
  });

  it("accepts icon buttons carrying either an aria-label or a native title", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        import { RefreshCw, ChevronLeft } from "lucide-react";

        const Demo = ({ onRefresh, onBack }) => (
          <div>
            <button aria-label="Refresh activity" onClick={onRefresh}><RefreshCw /></button>
            <button title="Back" onClick={onBack}><ChevronLeft /></button>
          </div>
        );
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("still treats unknown self-closing components as potential label text", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        import { FormattedMessage } from "react-intl";

        const Demo = ({ onSave }) => (
          <button onClick={onSave}><FormattedMessage id="actions.save" /></button>
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

  it("accepts component-wrapped Label with static htmlFor matching control id (shadcn/Radix pattern)", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        import { Label } from '@/components/ui/label';

        const Demo = () => (
          <div className="space-y-2">
            <Label htmlFor="departmentId">Department</Label>
            <select id="departmentId" name="departmentId">
              <option value="">All</option>
            </select>
          </div>
        );
      `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("accepts component-wrapped Label with dynamic htmlFor matching control id", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        import { Label } from '@/components/ui/label';

        const Demo = ({ fieldId }) => (
          <div className="space-y-2">
            <Label htmlFor={fieldId}>Department</Label>
            <select id={fieldId} name="department">
              <option value="">All</option>
            </select>
          </div>
        );
      `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not trust htmlFor on a component that does not render a label", () => {
    const result = runRule(
      controlHasAssociatedLabel,
      `
        const FormLabel = ({ children }) => <span>{children}</span>;

        const Demo = () => (
          <div>
            <FormLabel htmlFor="email">Email</FormLabel>
            <input id="email" type="email" name="email" />
          </div>
        );
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });
});
