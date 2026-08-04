import { useImperativeHandle, useState } from "react";
import type { Ref } from "react";

interface PanelHandle {
  collapse(): void;
}

interface PanelProperties {
  ref?: Ref<PanelHandle>;
}

const Panel = ({ ref }: PanelProperties) => {
  useImperativeHandle(ref, () => ({
    collapse: () => undefined,
  }));
  return <aside />;
};

export const Application = () => {
  const [, setHandle] = useState<PanelHandle | null>(null);
  return <Panel ref={(handle) => setHandle(handle)} />;
};
