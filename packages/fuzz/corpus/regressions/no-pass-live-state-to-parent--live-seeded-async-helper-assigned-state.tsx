// rule: no-pass-live-state-to-parent
// weakness: initializer-provenance
// source: Synthetic native parity regression
import { useEffect } from "react";
import { useRemote } from "state-library";
export function Child({ config, onChange }) {
  const state = useRemote(config);
  useEffect(() => {
    const update = async () => {
      let value;
      value = state.value;
      onChange({ ...config, value });
    };
    update();
  }, [state]);
  return null;
}
