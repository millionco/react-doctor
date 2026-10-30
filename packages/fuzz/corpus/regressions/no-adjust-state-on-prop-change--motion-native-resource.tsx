// rule: no-adjust-state-on-prop-change
// verdict: pass
// weakness: library-idiom
// source: synthetic public Motion native resource contract
import { useEffect, useState } from "react";
import { motion } from "framer-motion";

export const MotionResourceCard = ({ resourceUrl }) => {
  const [didFail, setDidFail] = useState(false);
  useEffect(() => setDidFail(false), [resourceUrl]);
  return <motion.video src={resourceUrl} onError={() => setDidFail(true)} hidden={didFail} />;
};
