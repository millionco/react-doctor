// rule: no-array-index-as-key
// verdict: pass
export const Slider = ({ values, label }) =>
  values?.map((_, index) => <Thumb key={index} aria-label={label} />);
