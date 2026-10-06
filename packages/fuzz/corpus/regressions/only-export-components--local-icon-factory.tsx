// rule: only-export-components
// weakness: library-idiom
// source: saved candidate audit, local icon factory
// verdict: pass
import { forwardRef } from "react";
const createIcon = (name: string) => {
  const Icon = forwardRef<SVGSVGElement>((props, ref) => <svg ref={ref} {...props} />);
  Icon.displayName = name;
  return Icon;
};
export const Arrow = createIcon("Arrow");
export const Panel = () => <main />;
