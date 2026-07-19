// rule: jsx-numeric-and-leaked-render
// weakness: name-heuristic
// source: adversarial audit of render/data-safety rules
export const Label = ({ label }: { label: string }) => <>{"prefix" + label && <span />}</>;
