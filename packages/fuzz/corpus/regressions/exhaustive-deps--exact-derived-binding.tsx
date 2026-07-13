// rule: exhaustive-deps
// weakness: alias-guard
// source: React Bench write-react-hyparam-hightable-468

import { type Context, useCallback, useContext } from "react";

interface CallbackContextValue {
  onSelect?: () => void;
}

interface DerivedCallbackProps {
  onSelect?: () => void;
  callbackContext: Context<CallbackContextValue>;
}

export const DerivedCallback = ({ onSelect, callbackContext }: DerivedCallbackProps) => {
  const contextCallbacks = useContext(callbackContext);
  const effectiveOnSelect = onSelect ?? contextCallbacks.onSelect;
  return useCallback(() => effectiveOnSelect?.(), [effectiveOnSelect]);
};
