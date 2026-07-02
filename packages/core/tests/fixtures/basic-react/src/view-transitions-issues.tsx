import { unstable_ViewTransition as ViewTransition } from "react";
import { flushSync } from "react-dom";

// no-document-start-view-transition: direct call in a file using <ViewTransition>.
export const startNativeTransition = () => {
  document.startViewTransition(() => {
    document.body.classList.toggle("dark");
  });
};

export const ThemedPanel = () => (
  <ViewTransition>
    <div>panel</div>
  </ViewTransition>
);

// no-flush-sync: import + call.
export const ForceFlushed = () => {
  const refresh = () => {
    flushSync(() => {
      console.log("flush");
    });
  };
  return <button onClick={refresh}>Refresh</button>;
};
