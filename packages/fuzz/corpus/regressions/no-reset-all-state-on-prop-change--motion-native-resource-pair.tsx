// rule: no-reset-all-state-on-prop-change
// verdict: pass
// weakness: library-idiom
// source: synthetic public Motion resource collateral control
import { useEffect, useState } from "react";
import { motion } from "framer-motion";

export const MotionResourcePair = ({ resourceUrl, otherUrl }) => {
  const [didFail, setDidFail] = useState(false);
  const [otherFailed, setOtherFailed] = useState(false);
  useEffect(() => {
    setDidFail(false);
    setOtherFailed(false);
  }, [resourceUrl, otherUrl]);
  return (
    <>
      <motion.video src={resourceUrl} onError={() => setDidFail(true)} hidden={didFail} />
      <motion.img src={otherUrl} onError={() => setOtherFailed(true)} hidden={otherFailed} />
    </>
  );
};
