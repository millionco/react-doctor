// rule: no-unowned-async-error-clear
// weakness: async-request-ownership
// source: ReactBench Tombelieber SessionInteractionCard

import { useEffect, useState } from "react";

interface RequestRecord {
  failed: boolean;
  requestId: string;
}

interface RequestCardProperties {
  currentRequestId: string;
  respond: (request: RequestRecord) => Promise<void>;
}

export const RequestCard = ({ currentRequestId, respond }: RequestCardProperties) => {
  const [errorRequestId, setErrorRequestId] = useState<string | null>(null);

  useEffect(() => {
    if (errorRequestId !== null && errorRequestId !== currentRequestId) {
      setErrorRequestId(null);
    }
  }, [currentRequestId, errorRequestId]);

  const handleRespond = async (request: RequestRecord) => {
    await respond(request);
    setErrorRequestId(request.failed ? request.requestId : null);
  };

  return (
    <button
      type="button"
      onClick={() => handleRespond({ failed: false, requestId: currentRequestId })}
    >
      Retry
    </button>
  );
};
