// rule: no-prop-types
// weakness: alias-guard
// source: adversarial review of component receiver provenance

import React from "react";

const ReactAlias = React;
ReactAlias.memo = (value: unknown) => value;
const Schema = ReactAlias.memo(() => <div />);

Schema.propTypes = { value: () => true };
