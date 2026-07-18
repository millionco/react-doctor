import debounce from "lodash/debounce";
import { useEffect, useMemo } from "react";

export const Preview = () => {
  const syncPosition = useMemo(() => debounce(() => window.scrollTo(0, 0), 100), []);
  useEffect(() => syncPosition(), [syncPosition]);
  return null;
};
