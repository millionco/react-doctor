// rule: no-array-index-as-key
// weakness: wrapper-transparency
// source: ReactBench write-react-docusaurus-tabs-1173

import { Children, Fragment, type ReactNode } from "react";

export const TabChildren = ({ children }: { children: ReactNode }) => {
  const normalized = Children.toArray(children);
  return normalized.map((child, index) => <Fragment key={index}>{child}</Fragment>);
};
