import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { queryNoMutationInEffectAsRead } from "./query-no-mutation-in-effect-as-read.js";

describe("query-no-mutation-in-effect-as-read", () => {
  it("flags a destructured data read fed from a mutate-in-effect", () => {
    const result = runRule(
      queryNoMutationInEffectAsRead,
      `function C() {
         const { mutateAsync, data } = useGetMarkedAsSpamRetailers();
         useEffect(() => { mutateAsync(ids); }, [ids]);
         return <div>{data.retailers}</div>;
       }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an awaited mutateAsync result captured in the effect", () => {
    const result = runRule(
      queryNoMutationInEffectAsRead,
      `function C() {
         const { mutateAsync } = useMutation(opts);
         useEffect(() => {
           (async () => {
             const response = await mutateAsync(params);
             setLogs(response.logs);
           })();
         }, [id]);
         return null;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an aliased useMutation with data read in useMemo", () => {
    const result = runRule(
      queryNoMutationInEffectAsRead,
      `import { useMutation as useGetLocales } from '@tanstack/react-query';
       function C() {
         const { mutate, data } = useGetLocales(opts);
         useEffect(() => { mutate(payload); }, [dep]);
         const options = useMemo(() => (data ? data.available_locales : []), [data]);
         return options;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a fire-and-forget write that never reads data", () => {
    const result = runRule(
      queryNoMutationInEffectAsRead,
      `function C() {
         const { mutate } = useMutation(opts);
         useEffect(() => { mutate(progress); }, [progress]);
         return null;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when data is read only as an acknowledgement field", () => {
    const result = runRule(
      queryNoMutationInEffectAsRead,
      `function C() {
         const { mutate, data } = useUploadEvent(opts);
         useEffect(() => { mutate(buildEvent()); }, [id]);
         return data?.success ? <Done /> : <Pending />;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a then-handler that reads the response body in the effect", () => {
    const result = runRule(
      queryNoMutationInEffectAsRead,
      `function C() {
         const { mutateAsync } = useMutation(opts);
         useEffect(() => {
           mutateAsync(params).then((response) => setLogs(response.logs));
         }, [id]);
         return null;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a destructured awaited response body in the effect", () => {
    const result = runRule(
      queryNoMutationInEffectAsRead,
      `function C() {
         const { mutateAsync } = useMutation(opts);
         useEffect(() => {
           (async () => {
             const { logs } = await mutateAsync(params);
             setLogs(logs);
           })();
         }, [id]);
         return null;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag the pre-optional-chaining ack guard `data && data.success`", () => {
    const result = runRule(
      queryNoMutationInEffectAsRead,
      `function C() {
         const { mutate, data } = useUploadEvent(opts);
         useEffect(() => { mutate(buildEvent()); }, [id]);
         return data && data.success ? <Done /> : <Pending />;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an early-return existence guard before an ack read", () => {
    const result = runRule(
      queryNoMutationInEffectAsRead,
      `function C() {
         const { mutate, data } = useUploadEvent(opts);
         useEffect(() => { mutate(buildEvent()); }, [id]);
         if (!data) return <Pending />;
         return data.success ? <Done /> : <Failed />;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a mutate fired from a socket handler registered in the effect", () => {
    const result = runRule(
      queryNoMutationInEffectAsRead,
      `function C() {
         const { mutate, data } = useMutation(opts);
         useEffect(() => {
           const onMessage = (event) => mutate(JSON.parse(event.data));
           socket.addEventListener('message', onMessage);
           return () => socket.removeEventListener('message', onMessage);
         }, []);
         return data ? <div>{data.value}</div> : null;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag SWR's revalidate-style mutate alongside a data render", () => {
    const result = runRule(
      queryNoMutationInEffectAsRead,
      `import useSWR from 'swr';
       function C() {
         const { data, mutate } = useSWR('/api/user', fetcher);
         useEffect(() => { mutate(); }, [focusCount]);
         return <div>{data.name}</div>;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an awaited response destructured to ack fields only", () => {
    const result = runRule(
      queryNoMutationInEffectAsRead,
      `function C() {
         const { mutateAsync } = useMutation(opts);
         useEffect(() => {
           (async () => {
             const { success } = await mutateAsync(params);
             if (!success) reportFailure();
           })();
         }, [id]);
         return null;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a then-handler that ignores the response", () => {
    const result = runRule(
      queryNoMutationInEffectAsRead,
      `function C() {
         const { mutateAsync } = useMutation(opts);
         useEffect(() => {
           mutateAsync(params).then(() => setDone(true));
         }, [id]);
         return null;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a mutate called only from a handler", () => {
    const result = runRule(
      queryNoMutationInEffectAsRead,
      `function C() {
         const { mutate, data } = useMutation(opts);
         const onClick = () => mutate(x);
         return <button onClick={onClick}>{data.value}</button>;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when data is consumed but the mutation never fires in an effect", () => {
    const result = runRule(
      queryNoMutationInEffectAsRead,
      `function C() {
         const { mutate, data } = useMutation(opts);
         return <div>{data.value}</div>;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a mutate fired via a local helper the effect calls synchronously", () => {
    const result = runRule(
      queryNoMutationInEffectAsRead,
      `function C() {
         const { mutate, data } = useMutation(opts);
         useEffect(() => {
           const run = () => { mutate(ids); };
           run();
         }, [ids]);
         return <div>{data.items}</div>;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a mutate fired via a function-declaration helper outside the effect", () => {
    const result = runRule(
      queryNoMutationInEffectAsRead,
      `function C() {
         const { mutate, data } = useMutation(opts);
         function load() { mutate(id); }
         useEffect(() => { load(); }, [id]);
         return <div>{data.items}</div>;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a mutate inside a handler returned by a factory called in the effect", () => {
    const result = runRule(
      queryNoMutationInEffectAsRead,
      `function C() {
         const { mutate, data } = useMutation(opts);
         const createHandler = () => () => mutate(event);
         useEffect(() => {
           socket.addEventListener('message', createHandler());
         }, []);
         return data ? <div>{data.value}</div> : null;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a useSWR-named alias of a useMutation import", () => {
    const result = runRule(
      queryNoMutationInEffectAsRead,
      `import { useMutation as useSWRLocales } from '@tanstack/react-query';
       function C() {
         const { mutate, data } = useSWRLocales(opts);
         useEffect(() => { mutate(payload); }, [dep]);
         return <div>{data.available_locales}</div>;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a local useSWR-prefixed wrapper that exposes mutateAsync", () => {
    const result = runRule(
      queryNoMutationInEffectAsRead,
      `function C() {
         const { mutateAsync, data } = useSWRLocales();
         useEffect(() => { mutateAsync(payload); }, [dep]);
         return <div>{data.available_locales}</div>;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag useSWR re-exported through a local barrel", () => {
    const result = runRule(
      queryNoMutationInEffectAsRead,
      `import { useSWR } from '~/lib/swr';
       function C() {
         const { data, mutate } = useSWR('/api/user', fetcher);
         useEffect(() => { mutate(); }, [focusCount]);
         return <div>{data.name}</div>;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a mutate-only local useSWR-prefixed wrapper", () => {
    const result = runRule(
      queryNoMutationInEffectAsRead,
      `function C() {
         const { mutate, data } = useSWRUser();
         useEffect(() => { mutate(); }, [focusCount]);
         return <div>{data.name}</div>;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an awaited result that is never read", () => {
    const result = runRule(
      queryNoMutationInEffectAsRead,
      `function C() {
         const { mutateAsync } = useMutation(opts);
         useEffect(() => {
           (async () => { await mutateAsync(params); })();
         }, [id]);
         return null;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a create-once mutation gated by its own isSuccess early return", () => {
    const result = runRule(
      queryNoMutationInEffectAsRead,
      `const ConnectUsingCli = () => {
        const {
          mutate: mutateAccessToken,
          data: tokenData,
          isSuccess: isTokenCreated,
        } = useCreateAccessToken();

        useEffect(() => {
          if (isTokenCreated) return;
          mutateAccessToken({ expiresAt: new Date() });
        }, [isTokenCreated, mutateAccessToken]);

        return <pre>{tokenData?.token}</pre>;
      };`,
      { filename: "connect.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a one-shot write gated by a run-once ref latch (payment redirect shape)", () => {
    const result = runRule(
      queryNoMutationInEffectAsRead,
      `const PaymentProcessing = () => {
        const { mutateAsync: updatePaymentInstrumentForOrder } =
          useShopperOrdersMutation('updatePaymentInstrumentForOrder');
        const isHandled = useRef(false);

        async function handleAdyenRedirect(order) {
          const updatedOrder = await updatePaymentInstrumentForOrder({
            parameters: { orderNo: order.orderNo },
          });
          return updatedOrder.paymentInstruments.length > 0;
        }

        useEffect(() => {
          (async () => {
            if (isHandled.current) {
              return;
            }
            isHandled.current = true;
            const success = await handleAdyenRedirect(order);
            if (success) navigate('/confirmation');
          })();
        }, [order]);

        return null;
      };`,
      { filename: "payment-processing.jsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a mutation-as-read when a ref is assigned but never latch-tested", () => {
    const result = runRule(
      queryNoMutationInEffectAsRead,
      `const Profile = () => {
        const { mutateAsync: fetchProfile } = useFetchProfile();
        const latestRef = useRef(null);
        useEffect(() => {
          (async () => {
            const profile = await fetchProfile(userId);
            latestRef.current = true;
            render(profile.details);
          })();
        }, [userId]);
        return null;
      };`,
      { filename: "profile.tsx" },
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
