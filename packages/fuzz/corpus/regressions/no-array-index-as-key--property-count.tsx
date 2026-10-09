// rule: no-array-index-as-key
// verdict: pass
export const Slots = ({ settings, value }) =>
  Array.from({ length: settings.rows }, (_, index) => <span key={index}>{value}</span>);
