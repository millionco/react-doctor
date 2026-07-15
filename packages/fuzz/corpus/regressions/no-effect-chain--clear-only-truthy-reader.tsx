// rule: no-effect-chain
// weakness: control-flow
// source: CrowdSec React Bench jobs bnXmGtJ and yvEQ2y5

import { useEffect, useState } from "react";

export const ErrorDialog = ({ isOpen }) => {
  const [error, setError] = useState<Error | null>(null);
  const [announcement, setAnnouncement] = useState("ready");

  useEffect(() => {
    if (!isOpen) setError(null);
  }, [isOpen]);

  useEffect(() => {
    if (error) setAnnouncement(error.message);
  }, [error]);

  return announcement;
};
