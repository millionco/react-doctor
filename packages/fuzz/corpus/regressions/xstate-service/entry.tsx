// rule: exhaustive-deps
// verdict: safe
// file-path: corpus/regressions/xstate-service/entry.tsx
import { useCallback } from "react";
import { useService } from "@xstate/react";
import { service } from "./service";
export const View = () => {
  const [state, send] = useService(service);
  return useCallback(() => send("PING"), []);
};
