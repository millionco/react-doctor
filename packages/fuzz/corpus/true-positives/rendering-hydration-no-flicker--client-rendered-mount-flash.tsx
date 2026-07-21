// rule: rendering-hydration-no-flicker
// weakness: framework-gating
// source: 0.8.1-to-main all-rules parity audit
// verdict: fail

import { useEffect, useState } from "react";

export const ClientRenderedCalendar = () => {
  const [events, setEvents] = useState([]);

  useEffect(() => {
    setEvents([{ id: "conference", title: "Conference" }]);
  }, []);

  return <Calendar events={events} />;
};
