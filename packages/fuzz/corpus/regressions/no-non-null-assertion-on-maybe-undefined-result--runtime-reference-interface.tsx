// rule: no-non-null-assertion-on-maybe-undefined-result
// verdict: fail
// weakness: provider-erasure
// source: independently synthetic runtime map escape
const groups = new Map();
const expose = () => {
  interface groups {}
  mutate(groups);
};
expose();
const selected = groups.get("group") ? groups.get("group")!.value : null;
