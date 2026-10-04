// rule: effect-needs-cleanup
// verdict: pass
// weakness: cleanup-provenance
// source: React Bench 0.9.6 exhaustive audit

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

export const DetachedDocuments = ({ documents }) => {
  const documentMapRef = useRef(new Map(documents));
  const clearDocuments = useCallback(() => {
    const detachedDocuments = Array.from(documentMapRef.current.values());
    documentMapRef.current.clear();
    if (detachedDocuments.length === 0) return;
    setTimeout(() => detachedDocuments.forEach((document) => document.destroy()), 0);
  }, []);
  return <button onClick={clearDocuments}>Clear</button>;
};

export const MediaSubscription = ({ breakpoint, notify }) => {
  const subscribe = useCallback(() => {
    const media = window.matchMedia(breakpoint);
    const handleMatch = () => notify();
    if (media.addEventListener) {
      media.addEventListener("change", handleMatch);
      return () => media.removeEventListener("change", handleMatch);
    }
    media.addListener(handleMatch);
    return () => media.removeListener(handleMatch);
  }, [breakpoint, notify]);
  useSyncExternalStore(
    subscribe,
    () => false,
    () => false,
  );
  return null;
};

export const CleanupRegistry = ({ targets }) => {
  useEffect(() => {
    const cleanups = [];
    for (const target of targets) {
      const handler = () => undefined;
      target.addEventListener("change", handler);
      cleanups.push(() => target.removeEventListener("change", handler));
    }
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [targets]);
  return null;
};

export const IndirectDragStop = ({ startResizing }) => {
  const handleMouseMove = () => startResizing();
  const stopResizing = () => window.removeEventListener("mousemove", handleMouseMove);
  useEffect(() => {
    window.addEventListener("mousemove", handleMouseMove);
    return () => stopResizing();
  }, [startResizing]);
  return null;
};

export const VictoryRun = ({ timer }) => {
  const mountedRef = useRef(true);
  const runRef = useRef({ loopID: null });
  const cancelCurrentRun = useCallback(
    (force) => {
      if (runRef.current.loopID) timer.unsubscribe(runRef.current.loopID);
      if (force) runRef.current.loopID = null;
    },
    [timer],
  );
  useEffect(() => {
    runRef.current.loopID = timer.subscribe(() => undefined);
    return () => {
      mountedRef.current = false;
      cancelCurrentRun(true);
    };
  }, [cancelCurrentRun, timer]);
  return null;
};

export const IteratedListenerPairs = ({ elementRefs, enabledEvents, isCaptureEvent }) => {
  useEffect(() => {
    enabledEvents.forEach(({ event, listener }) =>
      elementRefs.forEach((element) =>
        element.addEventListener(event, listener, isCaptureEvent(event)),
      ),
    );
    return () =>
      enabledEvents.forEach(({ event, listener }) =>
        elementRefs.forEach((element) =>
          element.removeEventListener(event, listener, isCaptureEvent(event)),
        ),
      );
  }, [elementRefs, enabledEvents, isCaptureEvent]);
  return null;
};

export const DirectListenerPair = ({ element, onWheel }) => {
  useEffect(() => {
    const options = { passive: false };
    element.addEventListener("wheel", onWheel, options);
    return () => element.removeEventListener("wheel", onWheel);
  }, [element, onWheel]);
  return null;
};

export const CallbackRefReplacement = ({ handleWheel }) => {
  const viewportRef = useRef(null);
  const setViewport = useCallback(
    (node) => {
      const previous = viewportRef.current;
      if (previous && previous !== node) previous.removeEventListener("wheel", handleWheel);
      viewportRef.current = node;
      if (node) node.addEventListener("wheel", handleWheel, { passive: false });
    },
    [handleWheel],
  );
  return <div ref={setViewport} />;
};

export const InertEventTimer = () => {
  const suppressClickRef = useRef(false);
  const handlePointerUp = () => {
    suppressClickRef.current = true;
    setTimeout(() => {
      suppressClickRef.current = false;
    }, 100);
  };
  return <button onPointerUp={handlePointerUp}>Release</button>;
};

export const RefOwnedTimer = ({ delay, open }) => {
  const pendingShowRef = useRef(null);
  const cancelPendingShow = useCallback(() => {
    if (!pendingShowRef.current) return;
    clearTimeout(pendingShowRef.current.timer);
    pendingShowRef.current = null;
  }, []);
  useEffect(() => () => cancelPendingShow(), [cancelPendingShow]);
  useEffect(() => {
    cancelPendingShow();
    pendingShowRef.current = { timer: setTimeout(open, delay) };
  }, [cancelPendingShow, delay, open]);
  return null;
};

export const MountedGuardTimer = ({ setIsOpen }) => {
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  useEffect(() => {
    setTimeout(() => {
      if (!mounted.current) return;
      setIsOpen(true);
    }, 10);
  }, [setIsOpen]);
  return null;
};
