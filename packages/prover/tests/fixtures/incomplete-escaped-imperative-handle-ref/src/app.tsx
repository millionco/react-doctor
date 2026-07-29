import { useImperativeHandle, useRef } from "react";
import type { Ref } from "react";

interface DialogHandle {
  open(): void;
}

interface DialogProperties {
  ref?: Ref<DialogHandle>;
}

const Dialog = ({ ref }: DialogProperties) => {
  useImperativeHandle(ref, () => ({
    open: () => undefined,
  }));
  return <dialog />;
};

const inspectReference = (reference: unknown) => reference;

export const Application = () => {
  const dialogRef = useRef<DialogHandle | null>(null);
  return (
    <main>
      <Dialog ref={dialogRef} />
      <button type="button" onClick={() => inspectReference(dialogRef)}>
        Inspect ref
      </button>
    </main>
  );
};
