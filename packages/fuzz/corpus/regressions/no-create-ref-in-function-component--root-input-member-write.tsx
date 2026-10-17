// rule: no-create-ref-in-function-component
// verdict: pass
// weakness: wrapper-transparency
// source: synthetic

import { createRef, useRef } from "react";
interface PanelProps {
  active: boolean;
}
export const Panel = (props: PanelProps) => {
  const refs = useRef<Array<{ current: HTMLDivElement | null }>>([]);
  const makeRef = () => {
    const ref = createRef<HTMLDivElement>();
    refs.current.push(ref);
    return ref;
  };
  props.active = false;
  if (props.active) makeRef();
  return <div />;
};
