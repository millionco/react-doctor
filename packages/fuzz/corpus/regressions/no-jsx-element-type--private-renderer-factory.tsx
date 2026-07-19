// rule: no-jsx-element-type
// weakness: name-heuristic
// source: react-bench TRYL276

import React from "react";

const defaultRenderComponent = (props: React.HTMLProps<HTMLInputElement>): JSX.Element => (
  <input {...props} />
);

export const renderInput = defaultRenderComponent;
