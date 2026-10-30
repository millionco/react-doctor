// rule: no-adjust-state-on-prop-change, no-reset-all-state-on-prop-change
// verdict: fail
// weakness: copy-tracking
// source: synthetic public Motion stable binding control
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
export const ResourceStability = (props) => {
  var resourceUrl = props.firstUrl;
  const [didFail, setDidFail] = useState(false);
  useEffect(() => setDidFail(false), [resourceUrl]);
  var resourceUrl = props.otherUrl;
  return <motion.video hidden={didFail} src={resourceUrl} onError={() => setDidFail(true)} />;
};
