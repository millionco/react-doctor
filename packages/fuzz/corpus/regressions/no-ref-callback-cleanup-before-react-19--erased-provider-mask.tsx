// rule: no-ref-callback-cleanup-before-react-19
// verdict: pass
// weakness: provider-erasure
// source: synthetic
declare const require: any;
require("react").useCallback = () => () => undefined;
import { useCallback, useContext, useRef } from "react";
import { DisplayContext } from "./display-context";
export const Panel = () => {
  const reportSize = useContext(DisplayContext);
  const nodeRef = useRef(null);
  const track = useCallback(
    (node) => {
      if (!reportSize) return;
      if (!node) return;
      if (!window.ResizeObserver) return;
      reportSize(node);
      const resource = new window.ResizeObserver(() => reportSize(node));
      resource.observe(node);
      return () => {
        resource.unobserve(node);
        resource.disconnect();
      };
    },
    [reportSize],
  );
  const bind = useCallback(
    (node) => {
      nodeRef.current = node;
      const stop = track(node);
      return stop;
    },
    [track],
  );
  return <td ref={bind} />;
};
