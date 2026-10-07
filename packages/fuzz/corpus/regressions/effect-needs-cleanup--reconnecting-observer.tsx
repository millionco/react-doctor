// effect-needs-cleanup | wrapper-transparency | ReactBench Cloudscape visual context
import { useLayoutEffect } from "react";

export const VisualContextWatcher = ({ element }: { element: HTMLElement }): null => {
  useLayoutEffect(() => {
    let observer: MutationObserver | undefined;
    const refresh = () => {
      observer?.disconnect();
      observer = new MutationObserver(refresh);
      observer.observe(element, { attributes: true, childList: true });
    };
    refresh();
    return () => observer?.disconnect();
  }, [element]);
  return null;
};
