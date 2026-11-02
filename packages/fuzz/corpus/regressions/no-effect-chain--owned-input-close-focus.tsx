// rule: no-effect-chain
// weakness: control-flow
// source: Synthetic owned native input close-edge focus restoration.
// profile: The focused owned-input-close-focus test supplies React18 and styled-components5.
// verdict is project-specific; generic corpus loading does not supply that profile.
/* eslint-disable react/set-state-in-effect, react-hooks/exhaustive-deps -- Preserve the synthetic effect-chain and dependency shapes. */

import { useCallback, useEffect, useRef, useState } from "react";

const RESET_POSITION = -4;

export const CloseFocusField = ({ query, isActive }) => {
  const [opened, setOpened] = useState(true);
  const [position, setPosition] = useState(RESET_POSITION);
  const field = useRef(null);
  const restoreFocus = useCallback(() => {
    const element = field.current;
    if (element) {
      element.focus();
      setPosition(RESET_POSITION);
    }
  }, []);

  useEffect(() => {
    setOpened(false);
  }, [query]);

  useEffect(() => {
    if (opened && isActive && position > 0) {
      setPosition(position - 1);
    }
    if (isActive && position === 0) restoreFocus();
  }, [opened, restoreFocus]);

  return <input ref={field} onClick={() => setPosition(0)} />;
};
