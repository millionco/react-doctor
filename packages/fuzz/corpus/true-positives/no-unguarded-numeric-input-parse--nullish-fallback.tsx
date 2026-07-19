// rule: no-unguarded-numeric-input-parse
// weakness: control-flow
// source: adversarial audit of PR parsing/string-safety group

export const QuantityField = ({ setQuantity }: { setQuantity: (value: number) => void }) => (
  <input onChange={(event) => setQuantity(Number(event.target.value) ?? 1)} type="text" />
);
