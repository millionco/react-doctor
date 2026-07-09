// rule: no-array-index-as-key
// weakness: ast-shape
// source: cross-rule consistency audit (ant-design ColorPresets playground).
//         Same-item composite keys (`${message} ${index}`) were later
//         reclassified as true positives (fn-hunt sweep: appending the index
//         remints keys on reorder), so only the placeholder-construction
//         shapes remain ground-truth-valid here.
export const SliderThumbs = ({ values }: { values: number[] }) => (
  <div>
    {Array.from({ length: values.length }, (_, index) => (
      <Swatch key={index} />
    ))}
  </div>
);
export const PlaygroundGrid = ({ count }: { count: number }) => {
  const cols = [];
  for (let i = 0; i < count; i++) {
    cols.push(<Swatch key={i} />);
  }
  return <div>{cols}</div>;
};
declare const Swatch: (props: { key?: string }) => null;
