// rule: no-async-event-handler-without-reentry-guard
// verdict: pass
import { useState } from "react";
import api from "example-client";
const Example = ({ busy }) => {
  const [ready, setReady] = useState(false);
  const send = async (event) => {
    event.preventDefault();
    if (busy) return;
    await api.post("/items").then(() => {
      setReady(true);
    });
  };
  return <form onSubmit={send} />;
};
export default Example;
