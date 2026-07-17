import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { queryNoMutationInEffectAsRead } from "./query-no-mutation-in-effect-as-read.js";

const runMutationReadRule = (source: string) =>
  runRule(
    queryNoMutationInEffectAsRead,
    `import { useMutation } from "@tanstack/react-query";
     ${source}`,
  );

describe("query-no-mutation-in-effect-as-read", () => {
  it("flags data read from an imported useMutation result", () => {
    const result = runMutationReadRule(
      `function Component() {
         const { mutateAsync: fetchUsers, data } = useMutation(options);
         useEffect(() => { fetchUsers(params); }, [params]);
         return <div>{data.users}</div>;
       }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags whole-result member usage", () => {
    const result = runMutationReadRule(
      `function Component() {
         const fetchUsersMutation = useMutation(options);
         useEffect(() => { fetchUsersMutation.mutate(params); }, [params]);
         return <div>{fetchUsersMutation.data.users}</div>;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a TypeScript-wrapped awaited result", () => {
    const result = runMutationReadRule(
      `function Component() {
         const { mutateAsync: fetchUser } = useMutation(options);
         useEffect(() => {
           void (async () => {
             const response = await (fetchUser(params) as Promise<Response>);
             setUser(response.user);
           })();
         }, [params]);
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a named then handler that consumes the response", () => {
    const result = runMutationReadRule(
      `function Component() {
         const { mutateAsync: fetchUser } = useMutation(options);
         const handleResponse = (response) => setUser(response.user);
         useEffect(() => { fetchUser(params).then(handleResponse); }, [params]);
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a named onSuccess consumer", () => {
    const result = runRule(
      queryNoMutationInEffectAsRead,
      `import { useMutation as useFetchUser } from "@tanstack/react-query";
       function Component() {
         const handleResponse = (response) => setUser(response.user);
         const fetchUserMutation = useFetchUser({ mutationFn, onSuccess: handleResponse });
         useEffect(() => { fetchUserMutation.mutate(params); }, [params]);
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags calls from a named effect callback", () => {
    const result = runMutationReadRule(
      `function Component() {
         const { mutateAsync: fetchUser, data } = useMutation(options);
         const loadUser = () => { fetchUser(params); };
         useEffect(loadUser, [params]);
         return <div>{data.user.name}</div>;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags calls from a useCallback effect callback", () => {
    const result = runMutationReadRule(
      `import { useCallback } from "react";
       function Component() {
         const { mutateAsync: fetchUser, data } = useMutation(options);
         const loadUser = useCallback(() => { fetchUser(params); }, [fetchUser, params]);
         useEffect(loadUser, [loadUser]);
         return <div>{data.user.name}</div>;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("handles both mutate bindings from one result", () => {
    const result = runMutationReadRule(
      `function Component() {
         const {
           mutate: fetchUsers,
           mutateAsync: loadUsers,
           data,
         } = useMutation(options);
         useEffect(() => {
           fetchUsers(first);
           void loadUsers(second);
         }, [first, second]);
         return <div>{data.users.length}</div>;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores data references that appear only in effect dependencies", () => {
    const result = runMutationReadRule(
      `function Component() {
         const { mutateAsync: fetchUser, data } = useMutation(options);
         useEffect(() => { fetchUser(params); }, [params, data]);
         return null;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts static computed and later-destructured acknowledgement fields", () => {
    const result = runMutationReadRule(
      `function Component() {
         const { mutateAsync: checkUpload, data } = useMutation(options);
         useEffect(() => { checkUpload(params); }, [params]);
         const { ["success"]: didSucceed, status } = data;
         return didSucceed && data[\`message\`] && status ? <Done /> : null;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a later-destructured response body field", () => {
    const result = runMutationReadRule(
      `function Component() {
         const { mutateAsync: fetchUser, data } = useMutation(options);
         useEffect(() => { fetchUser(params); }, [params]);
         const { ["user"]: user } = data;
         return <div>{user.name}</div>;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a dominating same-effect run-once ref latch", () => {
    const result = runMutationReadRule(
      `import { useRef } from "react";
       function Component() {
         const { mutateAsync: fetchUser } = useMutation(options);
         const handled = useRef(false);
         useEffect(() => {
           void (async () => {
             if (handled.current) return;
             handled.current = true;
             const response = await fetchUser(params);
             setUser(response.user);
           })();
         }, [params]);
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not accept inverted latch polarity", () => {
    const result = runMutationReadRule(
      `function Component() {
         const { mutateAsync: fetchUser } = useMutation(options);
         const handled = useRef(false);
         useEffect(() => {
           if (!handled.current) return;
           handled.current = true;
           void fetchUser(params).then((response) => setUser(response.user));
         }, [params]);
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not accept a latch assigned before its guard", () => {
    const result = runMutationReadRule(
      `function Component() {
         const { mutateAsync: fetchUser } = useMutation(options);
         const handled = useRef(false);
         useEffect(() => {
           handled.current = true;
           if (handled.current) return;
           void fetchUser(params).then((response) => setUser(response.user));
         }, [params]);
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not accept a same-named shadow ref", () => {
    const result = runMutationReadRule(
      `function Component() {
         const { mutateAsync: fetchUser } = useMutation(options);
         const handled = useRef(false);
         useEffect(() => {
           if (handled.current) return;
           {
             const handled = { current: false };
             handled.current = true;
           }
           void fetchUser(params).then((response) => setUser(response.user));
         }, [params]);
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not accept a render-local current object as a run-once latch", () => {
    const result = runMutationReadRule(
      `function Component() {
         const { mutateAsync: fetchUser } = useMutation(options);
         const handled = { current: false };
         useEffect(() => {
           if (handled.current) return;
           handled.current = true;
           void fetchUser(params).then((response) => setUser(response.user));
         }, [params]);
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a dominating positive guard on the same mutation status", () => {
    const result = runMutationReadRule(
      `function Component() {
         const { mutateAsync: fetchUser, data, isSuccess } = useMutation(options);
         useEffect(() => {
           if (isSuccess) return;
           fetchUser(params);
         }, [params, isSuccess]);
         return <div>{data.user.name}</div>;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a static computed success status on a whole result", () => {
    const result = runMutationReadRule(
      `function Component() {
         const fetchUserMutation = useMutation(options);
         useEffect(() => {
           if (fetchUserMutation["status"] === "success") return;
           fetchUserMutation.mutate(params);
         }, [params, fetchUserMutation.status]);
         return <div>{fetchUserMutation.data.user.name}</div>;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not accept a guard from a different effect", () => {
    const result = runMutationReadRule(
      `function Component() {
         const { mutateAsync: fetchUser, data, isSuccess } = useMutation(options);
         useEffect(() => { if (isSuccess) return; logStatus(); }, [isSuccess]);
         useEffect(() => { fetchUser(params); }, [params]);
         return <div>{data.user.name}</div>;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not accept a non-dominating conditional status guard", () => {
    const result = runMutationReadRule(
      `function Component() {
         const { mutateAsync: fetchUser, data, isSuccess } = useMutation(options);
         useEffect(() => {
           if (shouldSkip) {
             if (isSuccess) return;
           }
           fetchUser(params);
         }, [params, isSuccess]);
         return <div>{data.user.name}</div>;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent on non-TanStack and generic write-shaped mutations", () => {
    const unrelated = runRule(
      queryNoMutationInEffectAsRead,
      `import { useMutation } from "another-library";
       const { mutateAsync: fetchUser, data } = useMutation(options);
       useEffect(() => { fetchUser(params); }, [params]);
       render(data.user);`,
    );
    const genericWrite = runMutationReadRule(
      `function Component() {
         const mutation = useMutation(options);
         useEffect(() => {
           void mutation.mutateAsync(payload).then((response) => setId(response.createdId));
         }, [payload]);
       }`,
    );
    expect(unrelated.diagnostics).toHaveLength(0);
    expect(genericWrite.diagnostics).toHaveLength(0);
  });
});
