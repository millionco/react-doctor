// rule: no-array-index-deref-without-bounds-or-empty-guard
// weakness: custom-receiver
// source: independent synthetic control

const matcher = {
  match() {
    return null;
  },
};

export const CustomMatch = () => <span>{matcher.match(/:*$/)![0].length}</span>;
