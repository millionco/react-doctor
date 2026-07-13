// rule: no-prop-types
// weakness: alias-guard
// source: adversarial review of component receiver provenance

import React from "react";

const ReactAlias = React;
const Mutator = ReactAlias;
const methodName = "memo";
Mutator[methodName] = (value: unknown) => value;
const Schema = ReactAlias.memo(() => <div />);

Schema.propTypes = { value: () => true };
