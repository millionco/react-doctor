// rule: no-create-ref-in-function-component
// verdict: pass
// weakness: wrapper-transparency
// source: synthetic

import { createRef, useRef } from "react";
interface PanelProps {
  options: { active: boolean };
}
const useEffect = (callback: () => void, dependencies: Array<{ active: boolean }>) => {
  dependencies[0].active = false;
};
export const Panel = (props: PanelProps) => {
  const refs = useRef<Array<{ current: HTMLDivElement | null }>>([]);
  const makeRef = () => {
    const ref = createRef<HTMLDivElement>();
    refs.current.push(ref);
    return ref;
  };
  useEffect(() => {}, [props.options]);
  if (props.options.active) makeRef();
  return <div />;
};
