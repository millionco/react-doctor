import { useImperativeHandle, useRef, useState } from "react";
import type { Ref } from "react";

interface LabelHandle {
  read(): string;
}

interface LabelProperties {
  label: string;
  ref?: Ref<LabelHandle>;
}

const Label = ({ label, ref }: LabelProperties) => {
  useImperativeHandle(
    ref,
    () => ({
      read: () => label,
    }),
    [],
  );
  return <output>{label}</output>;
};

export const Application = () => {
  const [label, setLabel] = useState("first");
  const labelRef = useRef<LabelHandle | null>(null);
  return (
    <main>
      <Label ref={labelRef} label={label} />
      <button type="button" onClick={() => setLabel(labelRef.current?.read() ?? label)}>
        Read
      </button>
    </main>
  );
};
