// rule: no-placeholder-only-field
// weakness: unresolved-attribute
// source: bugbot-pr-850

interface DynamicInputProps {
  type: string;
}

export const DynamicInput = ({ type }: DynamicInputProps) => (
  <input type={type} placeholder="Control hint" />
);

export const CheckboxInput = () => <input type={"checkbox"} placeholder="Ignored hint" />;
