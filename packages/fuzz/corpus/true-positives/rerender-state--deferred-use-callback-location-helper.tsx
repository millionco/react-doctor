// rule: rerender-state-only-in-handlers
// weakness: react-use-callback-resolution
// source: Cursor Bugbot discussion 3596487123 on PR 1311
import { useCallback, useState } from "react";

export const DeferredReactUseCallbackLocationHelper = () => {
  const [_logged, setLogged] = useState(false);
  const navigate = useCallback(() => setTimeout(() => history.pushState({}, "", "/next"), 0), []);

  return (
    <button
      onClick={() => {
        navigate();
        setLogged(true);
      }}
    >
      {location.pathname}
    </button>
  );
};
