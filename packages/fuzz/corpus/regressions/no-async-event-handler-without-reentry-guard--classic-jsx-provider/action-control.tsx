import { forwardRef } from "react";

const React = { createElement: () => null };
void React;

export const ActionControl = forwardRef(({ children, ...nativeProps }, forwardedRef) => (
  <button ref={forwardedRef} {...nativeProps}>
    {children}
  </button>
));
