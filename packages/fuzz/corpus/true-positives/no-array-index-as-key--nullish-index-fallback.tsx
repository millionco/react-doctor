// rule: no-array-index-as-key
// verdict: fail
// weakness: reachable-expression-branch
// source: React Bench Accordion trial 2PCvs5j, deduplicated with EAtLqrE

import { Children, Fragment, isValidElement } from "react";
import type { ReactNode } from "react";

export const Accordion = ({ children }: { children: ReactNode }) => {
  const validChildren = Children.toArray(children).filter(isValidElement);
  return validChildren.map((child, index) => <Fragment key={child.key ?? index}>{child}</Fragment>);
};
