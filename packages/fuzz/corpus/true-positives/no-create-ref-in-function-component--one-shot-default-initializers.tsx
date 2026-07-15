// rule: no-create-ref-in-function-component
// weakness: test-gating

import React from "react";
import { render } from "@testing-library/react";
import { FocusTrap } from "./focus-trap";

it("rejects executable defaults around a one-shot mount", () => {
  const FocusTarget = ({ target = observeRender() } = {}) => {
    const targetRef = React.createRef<HTMLButtonElement>();
    return (
      <FocusTrap targetRef={targetRef}>
        <button ref={targetRef}>{target}</button>
      </FocusTrap>
    );
  };

  const { missing = rerenderRoot() } = render(<FocusTarget />);
  void missing;
});
