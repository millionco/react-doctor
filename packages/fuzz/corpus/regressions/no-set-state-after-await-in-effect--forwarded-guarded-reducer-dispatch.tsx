// rule: no-set-state-after-await-in-effect
// weakness: forwarded-setter
// source: cancelled Promise continuation dispatches through a transparent setter helper
// verdict: pass
import { useEffect, useReducer } from "react";

const assign = <T,>(setter: (next: T) => void, next: T) => setter(next);

interface LoadAction {
  type: "loaded";
  value: string;
}

const loadReducer = (_value: string, action: LoadAction) => action.value;

export const LoadedValue = ({ source }: { source: Promise<string> }) => {
  const [value, dispatch] = useReducer(loadReducer, "");

  useEffect(() => {
    let ignore = false;
    source.then((loaded) => {
      if (!ignore) assign(dispatch, { type: "loaded", value: loaded });
    });
    return () => {
      ignore = true;
    };
  }, [source]);

  return <output>{value}</output>;
};
