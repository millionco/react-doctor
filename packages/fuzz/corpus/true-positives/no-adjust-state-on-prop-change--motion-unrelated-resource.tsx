// rule: no-adjust-state-on-prop-change
// verdict: fail
// weakness: library-idiom
// source: synthetic public Motion resource ownership control
import { useEffect, useState } from "react";
import { motion } from "motion/react";

export const UnrelatedMotionResource = ({ resourceUrl, otherUrl }) => {
  const [didFail, setDidFail] = useState(false);
  useEffect(() => setDidFail(false), [resourceUrl]);
  return <motion.video src={otherUrl} onError={() => setDidFail(true)} hidden={didFail} />;
};
