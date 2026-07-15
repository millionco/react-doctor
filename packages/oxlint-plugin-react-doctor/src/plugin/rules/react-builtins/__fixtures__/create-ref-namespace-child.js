import { createElement, useEffect } from "react";

export const Child = ({ target }) => createElement("input", { ref: target });

export const RetainingChild = ({ target, observe }) => {
  useEffect(() => observe(target), [observe, target]);
  return createElement("input", { ref: target });
};
