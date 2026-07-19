// rule: no-whole-object-default-losing-per-key-defaults
// weakness: control-flow
// source: adversarial audit of render/data-safety rules
const read = ({ value }: { value: number } = { value: 1 }) => value;
export const value = read(undefined);
