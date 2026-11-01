// rule: no-create-ref-in-function-component
// verdict: pass
// weakness: wrapper-transparency
// source: synthetic

import { createRef, useRef } from "react";
interface PanelProps {
  active: boolean;
  getRows: () => string[];
}
export const Panel = (props: PanelProps) => {
  const refs = useRef<Array<{ current: HTMLDivElement | null }>>([]);
  const makeRef = () => {
    const ref = createRef<HTMLDivElement>();
    refs.current.push(ref);
    return ref;
  };
  if (props.active) return null;
  if (props.active) makeRef();
  return <div />;
};
