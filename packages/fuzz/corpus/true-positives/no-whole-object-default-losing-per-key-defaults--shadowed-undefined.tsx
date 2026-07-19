// rule: no-whole-object-default-losing-per-key-defaults
// weakness: name-heuristic
const undefined = 3;
export const read = ({ value } = { value: undefined }) => value;
