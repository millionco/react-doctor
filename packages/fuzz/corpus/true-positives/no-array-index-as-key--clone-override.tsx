// rule: no-array-index-as-key
// verdict: fail
import { cloneElement } from "react";

export const Rows = ({ children }) =>
  children.map((child, index) => cloneElement(child, { key: index }));
