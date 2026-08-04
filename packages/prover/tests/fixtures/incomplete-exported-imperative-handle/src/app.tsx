import { useImperativeHandle } from "react";
import type { Ref } from "react";

interface DialogHandle {
  open(): void;
}

interface DialogProperties {
  ref?: Ref<DialogHandle>;
}

export const Dialog = ({ ref }: DialogProperties) => {
  useImperativeHandle(ref, () => ({
    open: () => undefined,
  }));
  return <dialog />;
};
