import type { FnMiningCase } from "../fn-mining-case.js";

// Doc pattern: `<label>` tied to no control (no htmlFor, no nested
// input). Variants probe expression-child heuristics, empty htmlFor,
// custom label components, and file-based skips.
export const labelHasAssociatedControlCases: FnMiningCase[] = [
  {
    ruleId: "label-has-associated-control",
    description: "canonical: <label>Name</label> with no htmlFor and no control",
    filePath: "src/form.tsx",
    code: `const Field = () => <label>Name</label>;`,
    shouldFire: true,
  },
  {
    ruleId: "label-has-associated-control",
    description: "label text plus {children} expression (may be assumed to render a control)",
    filePath: "src/form.tsx",
    code: `const Field = ({ children }: FieldProps) => <label>Name{children}</label>;`,
    shouldFire: false,
    carveOutReason:
      "`{children}` matches the rule's CONTROL_RENDERING_NAME_PATTERN — a renderable-named expression may hold the control (`<label>Name<input/></label>` composed by the caller), so the rule stays conservative.",
  },
  {
    ruleId: "label-has-associated-control",
    description: 'empty htmlFor: <label htmlFor="">Name</label> associates nothing',
    filePath: "src/form.tsx",
    code: `const Field = () => <label htmlFor="">Name</label>;`,
    shouldFire: true,
  },
  {
    ruleId: "label-has-associated-control",
    description: "i18n text child: <label>{formatMessage(m)}</label> with no control",
    filePath: "src/form.tsx",
    code: `const Field = ({ m }: { m: MessageDescriptor }) => <label>{formatMessage(m)}</label>;`,
    shouldFire: true,
  },
  {
    ruleId: "label-has-associated-control",
    description: "same bad label inside a .stories.tsx file (file-based skip)",
    filePath: "src/form.stories.tsx",
    code: `const Field = () => <label>Name</label>;`,
    shouldFire: false,
    carveOutReason:
      "Testlike-filename skip (`isTestlikeFilename`): Storybook/test surfaces are non-production code where a11y findings are unactionable noise — deliberate file-based gate.",
  },
  {
    ruleId: "label-has-associated-control",
    description: "custom <Label> design-system component with no control",
    filePath: "src/form.tsx",
    code: `const Field = () => <Label>Name</Label>;`,
    shouldFire: false,
    carveOutReason:
      "Only lowercase `label` (plus configured `labelComponents`) is checked: a custom <Label> may forward htmlFor internally or not render a <label> at all — opt-in via the labelComponents setting, not a recall bug.",
  },
];
