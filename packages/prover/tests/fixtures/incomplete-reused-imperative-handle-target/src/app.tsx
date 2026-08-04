import { useImperativeHandle, useRef } from "react";
import type { Ref } from "react";

interface PanelHandle {
  inspect(): void;
}

interface PanelProperties {
  ref?: Ref<PanelHandle>;
}

const inspectReference = (reference: unknown) => reference;

const Panel = ({ ref }: PanelProperties) => {
  useImperativeHandle(ref, () => ({
    inspect: () => {
      inspectReference(ref);
    },
  }));
  return <aside />;
};

export const Application = () => {
  const panelRef = useRef<PanelHandle | null>(null);
  return <Panel ref={panelRef} />;
};
