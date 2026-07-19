import debounce from "lodash/debounce";
import { useEffect, useMemo, useRef } from "react";

export const Preview = () => {
  const alive = useRef(true);
  const updateTitle = useMemo(
    () =>
      debounce(() => {
        if (!alive.current) return;
        document.title = "late";
      }, 100),
    [],
  );
  useEffect(() => updateTitle(), [updateTitle]);
  return null;
};
