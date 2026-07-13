// rule: no-prop-types
// weakness: control-flow
// source: PR #1195 concurrent review follow-up

export function BuildLabel() {
  let output = "label";
  function unused() {
    output = <div />;
  }
  void unused;
  return output;
}

BuildLabel.propTypes = { value: () => true };

export function BuildTitle(condition: boolean) {
  let output;
  if (condition) {
    output = <span />;
    return "title";
  }
  return output;
}

BuildTitle.propTypes = { value: () => true };
