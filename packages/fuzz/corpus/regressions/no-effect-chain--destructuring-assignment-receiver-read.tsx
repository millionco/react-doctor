// rule: no-effect-chain
// weakness: provenance
// source: PR #1322 ship review

import axios from "axios";
import { useEffect, useState } from "react";

let get;
let copy;
({ get } = axios);
({ ...copy } = axios);
void get;
void copy;

interface DestructuringAssignmentReceiverReadProps {
  source: number;
}

export const DestructuringAssignmentReceiverRead = ({
  source,
}: DestructuringAssignmentReceiverReadProps) => {
  const [intermediate, setIntermediate] = useState(source);
  const [target, setTarget] = useState(source);

  useEffect(() => setIntermediate(source), [source]);
  useEffect(() => {
    axios.get("/rows");
    setTarget(intermediate);
  }, [intermediate]);

  return target;
};
