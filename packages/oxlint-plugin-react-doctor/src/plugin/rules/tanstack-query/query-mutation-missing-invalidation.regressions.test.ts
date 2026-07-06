import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { queryMutationMissingInvalidation } from "./query-mutation-missing-invalidation.js";

describe("tanstack-query/query-mutation-missing-invalidation — regressions", () => {
  it("stays silent when a destructured `invalidateQueries` is called in onSuccess", () => {
    const { diagnostics } = runRule(
      queryMutationMissingInvalidation,
      `const { invalidateQueries } = useQueryClient(); useMutation({ mutationFn: deletePost, onSuccess: () => invalidateQueries({ queryKey: ["posts"] }) });`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags a mutation with no cache update at all", () => {
    const { diagnostics } = runRule(
      queryMutationMissingInvalidation,
      `const posts = useQuery({ queryKey: ["posts"], queryFn: fetchPosts });
      useMutation({ mutationFn: deletePost });`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when tRPC utils invalidate the cache in onSuccess", () => {
    const { diagnostics } = runRule(
      queryMutationMissingInvalidation,
      `const utils = api.useUtils(); useMutation({ mutationFn: toggleMonitor, onSuccess: () => utils.monitors.invalidate() });`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags a bare clear() destructured from an unrelated form helper", () => {
    const { diagnostics } = runRule(
      queryMutationMissingInvalidation,
      `const queryClient = useQueryClient();
      const { clear } = useForm();
      useMutation({ mutationFn: deletePost, onSuccess: () => clear() });`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a session.invalidate() on a non-query object", () => {
    const { diagnostics } = runRule(
      queryMutationMissingInvalidation,
      `const queryClient = useQueryClient();
      useMutation({ mutationFn: signOut, onSuccess: () => session.invalidate() });`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a mutation whose onSuccess only shows a toast", () => {
    const { diagnostics } = runRule(
      queryMutationMissingInvalidation,
      `const posts = useQuery({ queryKey: ["posts"], queryFn: fetchPosts });
      useMutation({ mutationFn: deletePost, onSuccess: () => toast.success("deleted") });`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent for a mutation in a file with no query usage at all", () => {
    const { diagnostics } = runRule(
      queryMutationMissingInvalidation,
      `useMutation({ mutationFn: subscribeToNewsletter });`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent when a local invalidate() helper only touches unrelated state", () => {
    const { diagnostics } = runRule(
      queryMutationMissingInvalidation,
      `const invalidate = () => setDirty(false); useMutation({ mutationFn: deletePost, onSuccess: () => invalidate() });`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags a local invalidate() helper with no cache update when queries exist", () => {
    const { diagnostics } = runRule(
      queryMutationMissingInvalidation,
      `const posts = useQuery({ queryKey: ["posts"], queryFn: fetchPosts });
      const invalidate = () => setDirty(false);
      useMutation({ mutationFn: deletePost, onSuccess: () => invalidate() });`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when onSuccess references a same-file helper that invalidates", () => {
    const { diagnostics } = runRule(
      queryMutationMissingInvalidation,
      `const queryClient = useQueryClient();
      function invalidate() {
        return queryClient.invalidateQueries({ queryKey: ["service-accounts"] });
      }
      useMutation({ mutationFn: disableServiceAccount, onSuccess: invalidate });`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent when onSuccess calls an invalidation helper from an imported hook", () => {
    const { diagnostics } = runRule(
      queryMutationMissingInvalidation,
      `const jobs = useQuery({ queryKey: ["jobs"], queryFn: fetchJobs });
      const invalidate = useInvalidate();
      useMutation({ mutationFn: removeAccount, onSuccess: () => invalidate(["accounts"]) });`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent when onSuccess calls an imported invalidate-named helper", () => {
    const { diagnostics } = runRule(
      queryMutationMissingInvalidation,
      `const queryClient = useQueryClient();
      useMutation({ mutationFn: createComment, onSuccess: () => invalidateCaseCommentQueries(queryClient, caseId) });`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent when onSuccess refetches via a useQuery refetch binding", () => {
    const { diagnostics } = runRule(
      queryMutationMissingInvalidation,
      `const { refetch } = useGetClaimedPerks();
      const perks = useQuery({ queryKey: ["perks"], queryFn: fetchPerks });
      useMutation({ mutationFn: claimPerk, onSuccess: () => refetch() });`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent when the mutationFn updates the cache through a query-cache-named helper", () => {
    const { diagnostics } = runRule(
      queryMutationMissingInvalidation,
      `const queryClient = useQueryClient();
      useMutation({
        mutationFn: async (request) => {
          const vertex = await fetchVertex(request);
          setVertexDetailsQueryCache(queryClient, vertex);
          return vertex;
        },
      });`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent when a helper receives the query client to update the cache", () => {
    const { diagnostics } = runRule(
      queryMutationMissingInvalidation,
      `const queryClient = useQueryClient();
      useMutation({ mutationFn: importGraph, onSuccess: (data) => fetchEntityDetails(queryClient, data) });`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent when onSuccess performs a full-page navigation", () => {
    const { diagnostics } = runRule(
      queryMutationMissingInvalidation,
      `const providers = useQuery({ queryKey: ["providers"], queryFn: fetchProviders });
      useMutation({
        mutationFn: connectProvider,
        onSuccess: (data) => {
          window.location.href = data.authUrl;
        },
      });`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags when onSuccess references a same-file helper with no cache update", () => {
    const { diagnostics } = runRule(
      queryMutationMissingInvalidation,
      `const posts = useQuery({ queryKey: ["posts"], queryFn: fetchPosts });
      const cleanup = () => setOpen(false);
      useMutation({ mutationFn: deletePost, onSuccess: cleanup });`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags when onSuccess only navigates within the SPA", () => {
    const { diagnostics } = runRule(
      queryMutationMissingInvalidation,
      `const posts = useQuery({ queryKey: ["posts"], queryFn: fetchPosts });
      const router = useRouter();
      useMutation({ mutationFn: deletePost, onSuccess: () => router.push("/posts") });`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("does not assert stale data as certain when invalidation happens at the mutate() call site", () => {
    const { diagnostics } = runRule(
      queryMutationMissingInvalidation,
      `function SaveButton() {
        const queryClient = useQueryClient();
        const mutation = useMutation({ mutationFn: (data) => api.save(data) });
        const onClick = () => mutation.mutate(payload, {
          onSuccess: () => queryClient.invalidateQueries({ queryKey: ["items"] }),
        });
        return <button onClick={onClick}>Save</button>;
      }`,
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("can leave");
  });
});
