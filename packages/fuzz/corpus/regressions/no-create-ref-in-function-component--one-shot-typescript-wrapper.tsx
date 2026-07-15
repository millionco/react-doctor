// rule: no-create-ref-in-function-component
// weakness: transparent-wrapper
// source: Bugbot review on millionco/react-doctor#1303

import React from "react";
import { render } from "@testing-library/react";

it("mounts a type-wrapped one-shot component", () => {
  const FocusTarget = () => {
    const buttonRef = React.createRef<HTMLButtonElement>();
    return <button ref={buttonRef}>Target</button>;
  };

  render((<FocusTarget />) as React.ReactElement);
});
