// rule: rules-of-hooks
// weakness: wrapper-transparency
// source: independently authored named render callback regression
import { forwardRef, useState } from "react";
const renderPanel = (props, ref) => {
  const [open] = useState(false);
  return <div ref={ref}>{open ? props.children : null}</div>;
};
export const Panel = forwardRef(renderPanel);
