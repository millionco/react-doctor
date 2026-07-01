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
});
