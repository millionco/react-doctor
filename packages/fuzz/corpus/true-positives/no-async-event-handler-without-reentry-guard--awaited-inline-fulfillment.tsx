// rule: no-async-event-handler-without-reentry-guard
// verdict: fail
import { useState } from "react";
import api from "example-client";
const Example = () => {
  const [ready, setReady] = useState(false);
  const send = async (event) => {
    event.preventDefault();
    await api.post("/items").then(() => {
      setReady(true);
    });
  };
  return <form onSubmit={send} />;
};
export default Example;
