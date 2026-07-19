// rule: no-effect-chain
// weakness: provenance
// source: PR #1322 ship review

import axios from "axios";
import { useEffect, useState } from "react";

const { get: importedGet } = axios;
const [importedPost] = [axios.post];
void importedGet;
void importedPost;

interface DestructuringReceiverReadProps {
  source: number;
}

export const DestructuringReceiverRead = ({ source }: DestructuringReceiverReadProps) => {
  const [intermediate, setIntermediate] = useState(source);
  const [target, setTarget] = useState(source);

  useEffect(() => setIntermediate(source), [source]);
  useEffect(() => {
    void axios.get("/rows");
    setTarget(intermediate);
  }, [intermediate]);

  return target;
};
