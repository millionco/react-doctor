// rule: no-create-ref-in-function-component
// weakness: test-gating
// source: vrk-kpa/suomifi-ui-components@b3b68b8c Modal.test.tsx

import React from "react";
import { render } from "@testing-library/react";
import { Modal } from "./modal";

it("focuses a requested element on its only committed mount", () => {
  const FocusTarget = () => {
    const buttonRef = React.createRef<HTMLButtonElement>();
    return (
      <Modal focusOnOpenRef={buttonRef}>
        <button ref={buttonRef}>Target</button>
      </Modal>
    );
  };

  const { getByText } = render(<FocusTarget />);
  void getByText;
});
