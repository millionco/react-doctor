import React from "react";

export const makeConditionalValue = <Value,>(compute: () => Value, enabled: boolean) =>
  enabled ? compute() : null;

export const makeUnreachableValue = <Value,>(compute: () => Value) => {
  return null;
  compute();
};

export const makeInputValue = <Value,>(compute: (enabled: boolean) => Value) => compute(false);

export const makeReplacedInitializerValue = <Value,>(compute: () => Value) => {
  Object.assign(React, { useState: () => [null] });
  return React.useState(() => compute())[0];
};
