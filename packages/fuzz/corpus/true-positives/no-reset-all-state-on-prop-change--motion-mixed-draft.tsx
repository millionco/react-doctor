// rule: no-reset-all-state-on-prop-change
// verdict: fail
// weakness: library-idiom
// source: synthetic public Motion mixed editable state control
import { useEffect, useState } from "react";
import { motion } from "framer-motion";

export const MotionResourceEditor = ({ resourceUrl }) => {
  const [didFail, setDidFail] = useState(false);
  const [draft, setDraft] = useState("");
  useEffect(() => {
    setDidFail(false);
    setDraft("");
  }, [resourceUrl]);
  return (
    <>
      <motion.video src={resourceUrl} onError={() => setDidFail(true)} hidden={didFail} />
      <input value={draft} onChange={(event) => setDraft(event.target.value)} />
    </>
  );
};
