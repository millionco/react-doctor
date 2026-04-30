import { forwardRef } from "react";

export const ForwardedInput = forwardRef<HTMLInputElement, { label: string }>(({ label }, ref) => (
  <label>
    {label}
    <input ref={ref} />
  </label>
));

ForwardedInput.displayName = "ForwardedInput";
