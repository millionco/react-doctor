// rule: no-async-event-handler-without-reentry-guard
// weakness: framework-gating
// source: independent synthetic PR review regression
// verdict: pass
// file-path: fixtures/imported-request-action/review-case.tsx
/** @jsx jsx */
const jsx = () => null;
import { useCallback } from "react";
import { send } from "./request";
import { useDialogState, useDialogActions } from "./state";
const Dialog = ({ dismiss }) => {
  const submit = useCallback(async () => {
    await send("/tasks.commit", {});
    dismiss();
  }, [dismiss]);
  return <button onClick={submit} />;
};
export const Screen = () => {
  const state = useDialogState();
  const { close } = useDialogActions();
  return state.open ? <Dialog dismiss={close} /> : null;
};
