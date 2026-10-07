// rule: no-unowned-async-error-clear
// verdict: fail
// weakness: request-ownership
// source: ReactBench semantic false negative
import { useState } from "react";

export const PermissionCard = ({ requestId, send }) => {
  const [isDelivering, setIsDelivering] = useState(false);
  const deliver = async () => {
    setIsDelivering(true);
    try {
      await send(requestId);
    } finally {
      setIsDelivering(false);
    }
  };
  return (
    <button disabled={isDelivering} onClick={deliver}>
      Deliver
    </button>
  );
};
