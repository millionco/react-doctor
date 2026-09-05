// rule: no-pass-data-to-parent
// weakness: wrapper-transparency
// source: Synthetic native parity regression
import { forwardRef, useEffect } from "react";
import { readValue } from "data-service";
export const Child = Object.assign(
  forwardRef((props, ref) => {
    const value = readValue();
    useEffect(() => {
      props.onChange(value);
    }, [value, props.onChange]);
    return null;
  }),
  { label: "child" },
);
