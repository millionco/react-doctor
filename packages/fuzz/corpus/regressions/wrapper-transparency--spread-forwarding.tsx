// rule: button-has-type, checked-requires-onchange-or-readonly, anchor-has-content
// weakness: wrapper-transparency
// source: FP-FIX history (spreads can supply the required prop at runtime)
export const Button = (props: Record<string, unknown>) => <button {...props} />;
export const Checkbox = ({ checked, ...rest }: { checked: boolean }) => (
  <input type="checkbox" checked={checked} {...rest} />
);
export const Anchor = (props: Record<string, unknown>) => <a href="/p" {...props} />;
export const TypedByAlias = ({ type: kind }: { type: "button" | "submit" }) => (
  <button type={kind}>x</button>
);
export const TypedByConst = () => {
  const kind = "submit";
  return <button type={kind}>Save</button>;
};
