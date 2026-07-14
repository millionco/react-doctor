// rule: exhaustive-deps
// weakness: effect-semantics
// source: react-bench trial e010b839-cbfd-4b6e-b0d8-88360ad7df41
import { useLayoutEffect, useState } from "react";

const contextPattern = /awsui-context-([\w-]+)/;

export const VisualContext = ({ elementRef }) => {
  const [value, setValue] = useState("");
  useLayoutEffect(() => {
    if (elementRef.current) {
      const contextParent = findUpUntil(elementRef.current, (node) =>
        Boolean(node.className.match(contextPattern)),
      );
      setValue(contextParent?.className.match(contextPattern)?.[1] ?? "");
    }
  });
  return <output>{value}</output>;
};
