import { useImperativeHandle, useRef } from "react";
import type { Ref } from "react";

interface ProbeHandle {
  ping(): void;
}

interface ProbeProperties {
  ref?: Ref<ProbeHandle>;
}

const Probe = ({ ref }: ProbeProperties) => {
  useImperativeHandle(ref, () => {
    console.log("creating probe handle");
    return {
      ping: () => undefined,
    };
  });
  return <output>ready</output>;
};

export const Application = () => {
  const probeRef = useRef<ProbeHandle | null>(null);
  return (
    <button type="button" onClick={() => probeRef.current?.ping()}>
      <Probe ref={probeRef} />
    </button>
  );
};
