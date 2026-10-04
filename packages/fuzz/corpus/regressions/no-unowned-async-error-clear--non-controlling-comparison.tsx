// rule: no-unowned-async-error-clear
// verdict: fail
// weakness: control-flow
// source: Cursor Bugbot review on PR #1574
import { useState } from "react";

export const RequestCard = ({ currentRequest, respond }) => {
  const [deliveryError, setDeliveryError] = useState(null);
  const deliver = async (request) => {
    const result = await respond(request);
    const isCurrentRequest = request.requestId === currentRequest.requestId;
    if (result.ok) setDeliveryError(null);
    else setDeliveryError({ requestId: request.requestId, reason: result.reason });
    return isCurrentRequest;
  };
  return <button onClick={() => deliver(currentRequest)}>Send</button>;
};
