// rule: no-unstable-nested-components
// verdict: fail
// weakness: anonymous React render callback was not recognized as a component
// source: reduced local regression
import { forwardRef } from "react";
export const Parent = forwardRef(() => {
  const Child = () => <input />;
  return <Child />;
});
