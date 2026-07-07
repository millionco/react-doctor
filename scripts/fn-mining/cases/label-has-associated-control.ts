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
    shouldFire: true,
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
    shouldFire: true,
  },
  {
    ruleId: "label-has-associated-control",
    description: "custom <Label> design-system component with no control",
    filePath: "src/form.tsx",
    code: `const Field = () => <Label>Name</Label>;`,
    shouldFire: true,
  },
];
