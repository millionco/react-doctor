// rule: js-combine-iterations
// weakness: alias-guard
// source: ReactBench RDFPFN792026 adversarial controls

export const getDynamicLabels = (items: Array<{ active: boolean; label: string }>) =>
  items.filter((item) => item.active).map((item) => item.label);

export const getDefaultedLabels = (props: { items?: string[] }) => {
  const { items = ["one", "two", "three"] } = props;
  return items.filter((item) => item !== "two").map((item) => item.toUpperCase());
};

export const getExtendedSideLabels = (extraSide: string) => {
  const sides = ["top", "right", "bottom", "left"];
  sides.push(extraSide);
  return sides.filter((side) => side !== "bottom").map((side) => side.toUpperCase());
};

export const getLargeFixedLabels = () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  return values.filter((value) => value % 2 === 0).map((value) => String(value));
};
