import { createContext, forwardRef, useContext } from "react";

export const ForwardedInput = forwardRef<HTMLInputElement, { label: string }>(({ label }, ref) => (
  <label>
    {label}
    <input ref={ref} />
  </label>
));

ForwardedInput.displayName = "ForwardedInput";

const ThemeContext = createContext<"light" | "dark">("light");

export const ThemedLabel = ({ text }: { text: string }) => {
  const theme = useContext(ThemeContext);
  return <span data-theme={theme}>{text}</span>;
};
