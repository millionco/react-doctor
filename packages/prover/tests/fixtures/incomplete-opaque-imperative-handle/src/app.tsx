import { useImperativeHandle, useRef } from "react";
import type { Ref } from "react";

interface ToolbarHandle {
  close(): void;
}

interface ToolbarProperties {
  ref?: Ref<ToolbarHandle>;
}

const Toolbar = ({ ref }: ToolbarProperties) => {
  const close = () => undefined;
  const handle = { close };
  useImperativeHandle(ref, () => handle, [handle]);
  return <nav />;
};

export const Application = () => {
  const toolbarRef = useRef<ToolbarHandle | null>(null);
  return (
    <button type="button" onClick={() => toolbarRef.current?.close()}>
      <Toolbar ref={toolbarRef} />
    </button>
  );
};
