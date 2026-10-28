// rule: no-unowned-async-error-clear
// verdict: pass
// weakness: copy-tracking
// source: invented request projection precision regression

import { useState } from "react";

export const RequestStatus = ({ payload, send }) => {
  let [failure, setFailure] = useState(null);
  setFailure = () => {};
  const requestId = payload.requestId;
  const submit = async () => {
    const result = await send({ requestId });
    if (result.ok) setFailure(null);
    else setFailure({ requestId, result });
  };
  return <button onClick={submit}>{failure ? "Retry" : "Send"}</button>;
};
