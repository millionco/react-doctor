import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUnownedAsyncErrorClear } from "./no-unowned-async-error-clear.js";

describe("no-unowned-async-error-clear", () => {
  it("flags request-scoped error state cleared after an unowned async completion", () => {
    const result = runRule(
      noUnownedAsyncErrorClear,
      `import { useState } from "react";
      function RequestCard({ currentRequest, respond }) {
        const [deliveryError, setDeliveryError] = useState(null);
        const deliver = async (request) => {
          const result = await respond(request);
          if (result.ok) setDeliveryError(null);
          else setDeliveryError({ requestId: request.requestId, reason: result.reason });
        };
        return <button onClick={() => deliver(currentRequest)}>Send</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts an identity guard before request-scoped error completion", () => {
    const result = runRule(
      noUnownedAsyncErrorClear,
      `import { useState } from "react";
      function RequestCard({ currentRequest, respond }) {
        const [deliveryError, setDeliveryError] = useState(null);
        const deliver = async (request) => {
          const result = await respond(request);
          if (request.requestId !== currentRequest.requestId) return;
          if (result.ok) setDeliveryError(null);
          else setDeliveryError({ requestId: request.requestId, reason: result.reason });
        };
        return <button onClick={() => deliver(currentRequest)}>Send</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a request identity comparison that does not control the clear", () => {
    const result = runRule(
      noUnownedAsyncErrorClear,
      `import { useState } from "react";
      function RequestCard({ currentRequest, respond }) {
        const [deliveryError, setDeliveryError] = useState(null);
        const deliver = async (request) => {
          const result = await respond(request);
          const isCurrentRequest = request.requestId === currentRequest.requestId;
          if (result.ok) setDeliveryError(null);
          else setDeliveryError({ requestId: request.requestId, reason: result.reason });
          return isCurrentRequest;
        };
        return <button onClick={() => deliver(currentRequest)}>Send</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a clear behind a request comparison with an unguarded alternative", () => {
    const result = runRule(
      noUnownedAsyncErrorClear,
      `import { useState } from "react";
      function RequestCard({ currentRequest, respond }) {
        const [deliveryError, setDeliveryError] = useState(null);
        const deliver = async (request) => {
          const result = await respond(request);
          if (!result.ok) {
            setDeliveryError({ requestId: request.requestId, reason: result.reason });
          }
          if (request.requestId === currentRequest.requestId || result.forceClear) {
            setDeliveryError(null);
          }
        };
        return <button onClick={() => deliver(currentRequest)}>Send</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a clear when every path into its branch proves request ownership", () => {
    const result = runRule(
      noUnownedAsyncErrorClear,
      `import { useState } from "react";
      function RequestCard({ currentRequest, respond }) {
        const [deliveryError, setDeliveryError] = useState(null);
        const deliver = async (request) => {
          const result = await respond(request);
          if (result.ok && request.requestId === currentRequest.requestId) {
            setDeliveryError(null);
          } else if (!result.ok) {
            setDeliveryError({ requestId: request.requestId, reason: result.reason });
          }
        };
        return <button onClick={() => deliver(currentRequest)}>Send</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a clear after an ownership exit that can fall through", () => {
    const result = runRule(
      noUnownedAsyncErrorClear,
      `import { useState } from "react";
      function RequestCard({ currentRequest, respond }) {
        const [deliveryError, setDeliveryError] = useState(null);
        const deliver = async (request) => {
          const result = await respond(request);
          if (request.requestId !== currentRequest.requestId && result.cancelled) return;
          if (result.ok) setDeliveryError(null);
          else setDeliveryError({ requestId: request.requestId, reason: result.reason });
        };
        return <button onClick={() => deliver(currentRequest)}>Send</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an unowned promise completion that replaces keyed delivery state", () => {
    const result = runRule(
      noUnownedAsyncErrorClear,
      `import { useState } from "react";
      function useResponseDelivery(requestId, outcome) {
        const [state, setState] = useState(null);
        outcome.then((result) => {
          setState({
            requestId,
            pending: false,
            error: result.ok ? null : result.error,
          });
        });
        return state;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags request-scoped activity cleared by an older async completion", () => {
    const result = runRule(
      noUnownedAsyncErrorClear,
      `import { useState } from "react";
      function PermissionCard({ requestId, send }) {
        const [isDelivering, setIsDelivering] = useState(false);
        const deliver = async () => {
          setIsDelivering(true);
          try {
            await send();
          } finally {
            setIsDelivering(false);
          }
        };
        return <button onClick={deliver} disabled={isDelivering}>{requestId}</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a stale completion that clears error ownership for a newer request", () => {
    const result = runRule(
      noUnownedAsyncErrorClear,
      `import { useCallback, useEffect, useState } from "react";
function RequestCard({ currentRequest, respond }) {
  const currentRequestId = currentRequest.requestId;
  const [error, setError] = useState(null);
  const [errorRequestId, setErrorRequestId] = useState(null);
  useEffect(() => {
    if (errorRequestId !== null && errorRequestId !== currentRequestId) {
      setError(null);
      setErrorRequestId(null);
    }
  }, [currentRequestId, errorRequestId]);
  const handleRespond = useCallback(async (request) => {
    const result = await respond(request);
    if (result.ok) {
      setError(null);
      setErrorRequestId(null);
    } else {
      setError(result.error);
      setErrorRequestId(request.requestId);
    }
  }, [respond]);
  return <button onClick={() => handleRespond(currentRequest)}>Retry</button>;
}
function Screen(props) {
  return <RequestCard currentRequest={props.request} respond={props.respond} />;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a functional ownership check before clearing the request error", () => {
    const result = runRule(
      noUnownedAsyncErrorClear,
      `import { useCallback, useEffect, useState } from "react";
function RequestCard({ currentRequest, respond }) {
  const currentRequestId = currentRequest.requestId;
  const [errorRequestId, setErrorRequestId] = useState(null);
  useEffect(() => {
    if (errorRequestId !== null && errorRequestId !== currentRequestId) {
      setErrorRequestId(null);
    }
  }, [currentRequestId, errorRequestId]);
  const handleRespond = useCallback(async (request) => {
    const result = await respond(request);
    if (result.ok) {
      setErrorRequestId((ownerId) => ownerId === request.requestId ? null : ownerId);
    } else {
      setErrorRequestId(request.requestId);
    }
  }, [respond]);
  return <button onClick={() => handleRespond(currentRequest)}>Retry</button>;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a current-request guard around the clear", () => {
    const result = runRule(
      noUnownedAsyncErrorClear,
      `import { useCallback, useEffect, useState } from "react";
function RequestCard({ currentRequest, respond }) {
  const currentRequestId = currentRequest.requestId;
  const [errorRequestId, setErrorRequestId] = useState(null);
  useEffect(() => {
    if (errorRequestId !== null && errorRequestId !== currentRequestId) {
      setErrorRequestId(null);
    }
  }, [currentRequestId, errorRequestId]);
  const handleRespond = useCallback(async (request) => {
    const result = await respond(request);
    if (result.ok && request.requestId === currentRequestId) {
      setErrorRequestId(null);
    } else if (!result.ok) {
      setErrorRequestId(request.requestId);
    }
  }, [currentRequestId, respond]);
  return <button onClick={() => handleRespond(currentRequest)}>Retry</button>;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not accept an unrelated request identity comparison", () => {
    const result = runRule(
      noUnownedAsyncErrorClear,
      `import { useCallback, useEffect, useState } from "react";
function RequestCard({ currentRequest, respond }) {
  const currentRequestId = currentRequest.requestId;
  const [errorRequestId, setErrorRequestId] = useState(null);
  useEffect(() => {
    if (errorRequestId !== null && errorRequestId !== currentRequestId) {
      setErrorRequestId(null);
    }
  }, [currentRequestId, errorRequestId]);
  const handleRespond = useCallback(async (request) => {
    const result = await respond(request);
    const isOriginalRequest = request.requestId === currentRequestId;
    if (result.ok) {
      setErrorRequestId(null);
    } else {
      setErrorRequestId(request.requestId);
    }
    return isOriginalRequest;
  }, [currentRequestId, respond]);
  return <button onClick={() => handleRespond(currentRequest)}>Retry</button>;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not accept a guard against an unrelated identity", () => {
    const result = runRule(
      noUnownedAsyncErrorClear,
      `import { useCallback, useEffect, useState } from "react";
function RequestCard({ currentRequest, respond }) {
  const currentRequestId = currentRequest.requestId;
  const [errorRequestId, setErrorRequestId] = useState(null);
  useEffect(() => {
    if (errorRequestId !== null && errorRequestId !== currentRequestId) {
      setErrorRequestId(null);
    }
  }, [currentRequestId, errorRequestId]);
  const handleRespond = useCallback(async (request) => {
    const result = await respond(request);
    if (result.ok && request.requestId === "archived") {
      setErrorRequestId(null);
    } else if (!result.ok) {
      setErrorRequestId(request.requestId);
    }
  }, [respond]);
  return <button onClick={() => handleRespond(currentRequest)}>Retry</button>;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts request state isolated by a key at every local component use", () => {
    const result = runRule(
      noUnownedAsyncErrorClear,
      `import { useCallback, useEffect, useState } from "react";
function RequestCard({ currentRequest, respond }) {
  const currentRequestId = currentRequest.requestId;
  const [errorRequestId, setErrorRequestId] = useState(null);
  useEffect(() => {
    if (errorRequestId !== null && errorRequestId !== currentRequestId) {
      setErrorRequestId(null);
    }
  }, [currentRequestId, errorRequestId]);
  const handleRespond = useCallback(async (request) => {
    const result = await respond(request);
    if (result.ok) {
      setErrorRequestId(null);
    } else {
      setErrorRequestId(request.requestId);
    }
  }, [respond]);
  return <button onClick={() => handleRespond(currentRequest)}>Retry</button>;
}
function Screen(props) {
  return <RequestCard key={props.request.requestId} currentRequest={props.request} respond={props.respond}>Retry</RequestCard>;
}
RequestCard.displayName = "RequestCard";`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not assume exported components are keyed at every render site", () => {
    const result = runRule(
      noUnownedAsyncErrorClear,
      `import { useCallback, useEffect, useState } from "react";
function RequestCard({ currentRequest, respond }) {
  const currentRequestId = currentRequest.requestId;
  const [errorRequestId, setErrorRequestId] = useState(null);
  useEffect(() => {
    if (errorRequestId !== null && errorRequestId !== currentRequestId) {
      setErrorRequestId(null);
    }
  }, [currentRequestId, errorRequestId]);
  const handleRespond = useCallback(async (request) => {
    const result = await respond(request);
    setErrorRequestId(result.ok ? null : request.requestId);
  }, [respond]);
  return <button onClick={() => handleRespond(currentRequest)}>Retry</button>;
}
function Screen(props) {
  return <RequestCard key={props.request.requestId} currentRequest={props.request} respond={props.respond} />;
}
export { RequestCard, Screen };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores nullable state without proven request ownership", () => {
    const result = runRule(
      noUnownedAsyncErrorClear,
      `import { useCallback, useState } from "react";
function Form({ save }) {
  const [errorRequestId, setErrorRequestId] = useState(null);
  const submit = useCallback(async (request) => {
    const result = await save(request);
    setErrorRequestId(result.ok ? null : request.requestId);
  }, [save]);
  return <button onClick={() => submit({ requestId: "profile" })}>Save</button>;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores ownership assignments that do not cross an await", () => {
    const result = runRule(
      noUnownedAsyncErrorClear,
      `import { useEffect, useState } from "react";
function RequestCard({ currentRequest }) {
  const currentRequestId = currentRequest.requestId;
  const [errorRequestId, setErrorRequestId] = useState(null);
  useEffect(() => {
    if (errorRequestId !== currentRequestId) setErrorRequestId(null);
  }, [currentRequestId, errorRequestId]);
  const update = (request) => setErrorRequestId(request.failed ? request.requestId : null);
  return <button onClick={() => update(currentRequest)}>Update</button>;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores a shadowed useState helper", () => {
    const result = runRule(
      noUnownedAsyncErrorClear,
      `const useState = (value) => [value, () => undefined];
function RequestCard({ currentRequest, respond }) {
  const currentRequestId = currentRequest.requestId;
  const [errorRequestId, setErrorRequestId] = useState(null);
  if (errorRequestId !== currentRequestId) setErrorRequestId(null);
  const handleRespond = async (request) => {
    const result = await respond(request);
    setErrorRequestId(result.ok ? null : request.requestId);
  };
  return <button onClick={() => handleRespond(currentRequest)}>Retry</button>;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
