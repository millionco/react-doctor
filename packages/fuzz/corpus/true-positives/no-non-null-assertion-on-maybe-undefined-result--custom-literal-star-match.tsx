// rule: no-non-null-assertion-on-maybe-undefined-result
// weakness: custom-receiver
// source: independent synthetic control
// verdict: fail

const matcher = {
  match() {
    return null;
  },
};

export const MatchWidth = () => <span>{matcher.match(/:*$/)![0].length}</span>;
