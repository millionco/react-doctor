import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { roleSupportsAriaProps } from "./role-supports-aria-props.js";

interface SelectAttributeCase {
  attributes: string;
  expectedCount: number;
  setup?: string;
}

interface SelectModeCase {
  name: string;
  mode?: string;
  expectedCount: number;
}

const SINGLE_SELECT_ATTRIBUTES = [
  'aria-autocomplete="none"',
  'multiple={false} aria-autocomplete="none"',
  'size={1} aria-autocomplete="none"',
  'multiple={false} size={1} aria-autocomplete="none"',
  'multiple={false as const} size={(1 satisfies number)} aria-autocomplete="none"',
  'multiple={(false)} size={(1)} aria-autocomplete="none"',
  'aria-autocomplete={"none"}',
  'aria-autocomplete={("none" as const)}',
  'multiple={false as unknown as boolean} size={1 as unknown as number} aria-autocomplete="none"',
  'size={0x1} aria-autocomplete={"none" satisfies string}',
];

const OUTSIDE_ADMISSION_CASES: SelectAttributeCase[] = [
  { attributes: 'multiple aria-autocomplete="none"', expectedCount: 1 },
  { attributes: 'multiple={true} aria-autocomplete="none"', expectedCount: 1 },
  { attributes: 'multiple="false" aria-autocomplete="none"', expectedCount: 1 },
  { attributes: 'multiple={0} aria-autocomplete="none"', expectedCount: 1 },
  { attributes: 'multiple={null} aria-autocomplete="none"', expectedCount: 1 },
  { attributes: 'multiple={undefined} aria-autocomplete="none"', expectedCount: 1 },
  {
    attributes: 'multiple={flag} aria-autocomplete="none"',
    setup: "const flag = false;",
    expectedCount: 1,
  },
  { attributes: 'multiple={unknown as false} aria-autocomplete="none"', expectedCount: 1 },
  { attributes: 'multiple={!true} aria-autocomplete="none"', expectedCount: 1 },
  { attributes: 'size={2} aria-autocomplete="none"', expectedCount: 1 },
  { attributes: 'multiple={false} size={2} aria-autocomplete="none"', expectedCount: 1 },
  { attributes: 'size={0} aria-autocomplete="none"', expectedCount: 1 },
  { attributes: 'size="1" aria-autocomplete="none"', expectedCount: 1 },
  { attributes: 'size={null} aria-autocomplete="none"', expectedCount: 1 },
  { attributes: 'size={undefined} aria-autocomplete="none"', expectedCount: 1 },
  {
    attributes: 'size={rows} aria-autocomplete="none"',
    setup: "const rows = 1;",
    expectedCount: 1,
  },
  { attributes: 'size={unknown as 1} aria-autocomplete="none"', expectedCount: 1 },
  { attributes: 'size={+1} aria-autocomplete="none"', expectedCount: 1 },
  { attributes: 'size={1n} aria-autocomplete="none"', expectedCount: 1 },
  { attributes: 'size={condition ? 1 : 1} aria-autocomplete="none"', expectedCount: 1 },
  { attributes: '{...props} aria-autocomplete="none"', expectedCount: 1 },
  { attributes: 'aria-autocomplete="none" {...props}', expectedCount: 1 },
  { attributes: 'multiple={false} multiple={false} aria-autocomplete="none"', expectedCount: 1 },
  { attributes: 'size={1} size={1} aria-autocomplete="none"', expectedCount: 1 },
  { attributes: 'aria-autocomplete="none" aria-autocomplete="none"', expectedCount: 2 },
  { attributes: 'Multiple={false} aria-autocomplete="none"', expectedCount: 1 },
  { attributes: 'SIZE={1} aria-autocomplete="none"', expectedCount: 1 },
  { attributes: 'aria-Autocomplete="none"', expectedCount: 1 },
  { attributes: 'role="listbox" aria-autocomplete="none"', expectedCount: 1 },
  { attributes: 'role="listbox" role="listbox" aria-autocomplete="none"', expectedCount: 1 },
  { attributes: 'Role="listbox" aria-autocomplete="none"', expectedCount: 1 },
  { attributes: 'role="combobox" aria-autocomplete="none"', expectedCount: 0 },
  { attributes: 'role={requestedRole} aria-autocomplete="none"', expectedCount: 0 },
  { attributes: "aria-autocomplete={token}", setup: 'const token = "none";', expectedCount: 1 },
  { attributes: 'aria-autocomplete={condition ? "none" : "none"}', expectedCount: 1 },
  { attributes: 'aria-autocomplete={unknown as "none"}', expectedCount: 1 },
  { attributes: 'aria-autocomplete="list"', expectedCount: 1 },
  { attributes: 'aria-autocomplete="inline"', expectedCount: 1 },
  { attributes: 'aria-autocomplete="both"', expectedCount: 1 },
  { attributes: 'aria-autocomplete="invalid"', expectedCount: 1 },
];

const MODE_CASES: SelectModeCase[] = [
  { name: "curated", mode: "curated", expectedCount: 0 },
  { name: "upstream", mode: "upstream", expectedCount: 1 },
  { name: "faithful", mode: "faithful", expectedCount: 1 },
  { name: "unknown", mode: "unknown", expectedCount: 1 },
  { name: "missing mode", expectedCount: 1 },
];

describe("native single-select autocomplete none admission", () => {
  it.each(SINGLE_SELECT_ATTRIBUTES)("admits curated literal attributes: %s", (attributes) => {
    const result = runRule(
      roleSupportsAriaProps,
      `export const DeliveryChoice = () => <select aria-label="Delivery choice" ${attributes}><option value="harbor">Harbor</option></select>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each(SINGLE_SELECT_ATTRIBUTES)("preserves upstream reports: %s", (attributes) => {
    const result = runRule(
      roleSupportsAriaProps,
      `export const DeliveryChoice = () => <select ${attributes} />;`,
      { settings: { "react-doctor": { portedRuleMode: "upstream" } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each(OUTSIDE_ADMISSION_CASES)(
    "preserves outside-boundary behavior: $attributes",
    ({ attributes, setup, expectedCount }) => {
      const result = runRule(
        roleSupportsAriaProps,
        `${setup ?? ""} export const DeliveryChoice = () => <select ${attributes} />;`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(expectedCount);
    },
  );

  it.each(MODE_CASES)("preserves the $name mode boundary", ({ mode, expectedCount }) => {
    const result = runRule(
      roleSupportsAriaProps,
      'export const DeliveryChoice = () => <select aria-autocomplete="none" />;',
      { settings: { "react-doctor": { portedRuleMode: mode } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });

  it.each(["NativeChoice", "ui.select", "SELECT"])(
    "does not infer native host ownership from mapping %s",
    (tagName) => {
      const result = runRule(
        roleSupportsAriaProps,
        `export const DeliveryChoice = () => <${tagName} aria-autocomplete="none" />;`,
        { settings: { "jsx-a11y": { components: { [tagName]: "select" } } } },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it("retains another unsupported property on the same admitted select", () => {
    const result = runRule(
      roleSupportsAriaProps,
      'export const DeliveryChoice = () => <select aria-autocomplete="none" aria-valuetext="Delivery" />;',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("aria-valuetext");
  });

  it.each(["curated", "upstream"])("preserves valuetext and adjacent behavior in %s", (mode) => {
    const result = runRule(
      roleSupportsAriaProps,
      `export const DeliveryChoice = () => <>
      <select aria-valuetext="Delivery" />
      <select aria-expanded="false" aria-label="Delivery" />
      <input aria-autocomplete="list" aria-controls="choices" aria-expanded />
      <input role="combobox" aria-autocomplete="list" aria-expanded="false" />
      <datalist aria-autocomplete="none" />
    </>;`,
      { settings: { "react-doctor": { portedRuleMode: mode } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(3);
  });
});
