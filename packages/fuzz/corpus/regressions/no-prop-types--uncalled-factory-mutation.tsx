// rule: no-prop-types
// weakness: control-flow
// source: adversarial review of component receiver provenance

import React from "react";

const mutateReact = () => {
  React.memo = (value: unknown) => value;
};
const Panel = React.memo(() => <div />);
Panel.propTypes = { value: () => true };

void mutateReact;
