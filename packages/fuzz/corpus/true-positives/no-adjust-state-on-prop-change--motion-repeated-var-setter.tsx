// rule: no-adjust-state-on-prop-change, no-reset-all-state-on-prop-change
// verdict: fail
// weakness: copy-tracking
// source: synthetic public Motion stable binding control
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
export const ResourceStability = (props) => {
  const resourceUrl = props.resourceUrl;
  var [didFail, setDidFail] = useState(false);
  useEffect(() => setDidFail(false), [resourceUrl]);
  var setDidFail = props.externalSetter;
  return <motion.video hidden={didFail} src={resourceUrl} onError={() => setDidFail(true)} />;
};
