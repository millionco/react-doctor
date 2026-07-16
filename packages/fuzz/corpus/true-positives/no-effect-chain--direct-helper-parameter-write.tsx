// rule: no-effect-chain
// weakness: provenance
// source: React Bench Payload paired control

import { useEffect, useState } from "react";

interface DirectHelperParameterWriteProps {
  selection: string;
}

export const DirectHelperParameterWrite = ({ selection }: DirectHelperParameterWriteProps) => {
  const [selected, setSelected] = useState("");
  const [status, setStatus] = useState("idle");
  const commitSelection = (nextSelection: string) => {
    setSelected(nextSelection);
  };

  useEffect(() => commitSelection(selection), [commitSelection, selection]);
  useEffect(() => {
    if (selected) setStatus("ready");
  }, [selected]);

  return status;
};
