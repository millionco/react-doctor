// rule: no-chain-state-updates
// weakness: control-flow
// source: Qovery write-react-qovery-console-2730 trials 58Whbjh and bssoTeE

import { useEffect, useRef, useState } from "react";

export const GuardedCalendar = ({
  defaultsRevision,
  timezone,
}: {
  defaultsRevision: string;
  timezone: string;
}) => {
  const [selectedRevision, setSelectedRevision] = useState(0);
  const [dateText, setDateText] = useState("");
  const previousDefaultsRevisionRef = useRef(defaultsRevision);
  const previousTimezoneRef = useRef(timezone);

  useEffect(() => {
    const didDefaultsChange = previousDefaultsRevisionRef.current !== defaultsRevision;
    const didTimezoneChange = previousTimezoneRef.current !== timezone;
    previousDefaultsRevisionRef.current = defaultsRevision;
    previousTimezoneRef.current = timezone;

    if (didDefaultsChange) {
      setDateText(defaultsRevision);
      return;
    }

    if (!didTimezoneChange) return;
    setDateText(String(selectedRevision));
  }, [defaultsRevision, selectedRevision, timezone]);

  return <button onClick={() => setSelectedRevision((value) => value + 1)}>{dateText}</button>;
};
