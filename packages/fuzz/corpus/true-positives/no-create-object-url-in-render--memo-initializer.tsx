// rule: no-create-object-url-in-render
// weakness: control-flow
// source: react-bench-5 FN audit

import { useMemo } from "react";

export const Preview = ({ data }: { data: Blob }) => {
  const source = useMemo(() => URL.createObjectURL(data), [data]);
  return <img src={source} alt="Preview" />;
};
