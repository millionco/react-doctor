import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { queryNoMutationInEffectAsRead } from "./query-no-mutation-in-effect-as-read.js";

const count = (code: string): number =>
  runRule(queryNoMutationInEffectAsRead, code).diagnostics.length;

describe("adversarial", () => {
  it("collects counts", () => {
    const results = {
      fp1Swr: count(
        `import useSWR from 'swr';
         function C() {
           const { data, mutate } = useSWR('/api/user', fetcher);
           useEffect(() => { mutate(); }, [id]);
           return <div>{data.name}</div>;
         }`,
      ),
      fp2Listener: count(
        `function C() {
           const { mutate, data } = useMutation(opts);
           useEffect(() => {
             const onOnline = () => mutate(pendingItems);
             window.addEventListener('online', onOnline);
             return () => window.removeEventListener('online', onOnline);
           }, [pendingItems]);
           return <div>{data?.items}</div>;
         }`,
      ),
      fp3AndGuard: count(
        `function C() {
           const { mutate, data } = useUploadEvent(opts);
           useEffect(() => { mutate(buildEvent()); }, [id]);
           return data && data.success ? <Done /> : <Pending />;
         }`,
      ),
      fp3bBareTruthiness: count(
        `function C() {
           const { mutate, data } = useUploadEvent(opts);
           useEffect(() => { mutate(buildEvent()); }, [id]);
           return data ? <Done /> : <Pending />;
         }`,
      ),
      fn1DestructuredAwait: count(
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
      ),
      fn1bThen: count(
        `function C() {
           const { mutateAsync } = useMutation(opts);
           useEffect(() => {
             mutateAsync(params).then((response) => setLogs(response.logs));
           }, [id]);
           return null;
         }`,
      ),
      fn1cDirectArg: count(
        `function C() {
           const { mutateAsync } = useMutation(opts);
           useEffect(() => {
             (async () => { setLogs(await mutateAsync(params)); })();
           }, [id]);
           return null;
         }`,
      ),
      fn2NonDestructured: count(
        `function C() {
           const mutation = useMutation(opts);
           useEffect(() => { mutation.mutate(params); }, [id]);
           return <div>{mutation.data.items}</div>;
         }`,
      ),
    };
    expect(results).toEqual("SENTINEL");
  });
});
