// rule: no-create-ref-in-function-component
// verdict: pass
// weakness: wrapper-transparency
// source: synthetic

import { createRef, useRef } from "react";
interface PanelProps {
  getRows: () => string[];
}
export const Panel = (props: PanelProps) => {
  const refs = useRef<Array<{ current: HTMLDivElement | null }>>([]);
  const makeRef = () => {
    const ref = createRef<HTMLDivElement>();
    refs.current.push(ref);
    return ref;
  };
  const rows = props.getRows();
  rows.length = 0;
  if (rows.length) makeRef();
  return <div />;
};
