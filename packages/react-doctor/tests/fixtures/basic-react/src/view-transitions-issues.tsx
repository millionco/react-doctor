import { flushSync } from "react-dom";

// no-document-start-view-transition: direct call.
export const startNativeTransition = () => {
  document.startViewTransition(() => {
    document.body.classList.toggle("dark");
  });
};

// no-flush-sync: import + call.
export const ForceFlushed = () => {
  const refresh = () => {
    flushSync(() => {
      console.log("flush");
    });
  };
  return <button onClick={refresh}>Refresh</button>;
};
