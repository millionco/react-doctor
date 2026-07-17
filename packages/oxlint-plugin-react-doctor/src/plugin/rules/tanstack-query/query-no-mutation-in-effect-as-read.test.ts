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

  it("flags an awaited result passed directly to a consumer", () => {
    const result = runMutationReadRule(
      `function Component() {
         const { mutateAsync: fetchUser } = useMutation(options);
         useEffect(() => {
           void (async () => setUser(await fetchUser(params)))();
         }, [params]);
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a member read directly from an awaited result", () => {
    const result = runMutationReadRule(
      `function Component() {
         const { mutateAsync: fetchUser } = useMutation(options);
         useEffect(() => {
           void (async () => setUser((await fetchUser(params)).user))();
         }, [params]);
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts an awaited result that is discarded", () => {
    const result = runMutationReadRule(
      `function Component() {
         const { mutateAsync: updateUser } = useMutation(options);
         useEffect(() => {
           void (async () => { await updateUser(params); })();
         }, [params]);
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts awaited results discarded by void and sequence positions", () => {
    const result = runMutationReadRule(
      `function Component() {
         const { mutateAsync: fetchUser } = useMutation(options);
         useEffect(() => {
           void (async () => {
             void (await fetchUser(first));
             (await fetchUser(second), recordAttempt());
           })();
         }, [first, second]);
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags an awaited result consumed as the final sequence value", () => {
    const result = runMutationReadRule(
      `function Component() {
         const { mutateAsync: fetchUser } = useMutation(options);
         useEffect(() => {
           void (async () => {
             const response = (prepare(), await fetchUser(params));
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

  it("flags a useCallback then handler that consumes the response", () => {
    const result = runMutationReadRule(
      `import { useCallback } from "react";
       function Component() {
         const { mutateAsync: fetchUser } = useMutation(options);
         const handleResponse = useCallback((response) => setUser(response.user), []);
         useEffect(() => { void fetchUser(params).then(handleResponse); }, [params]);
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a useCallback onSuccess handler that consumes the response", () => {
    const result = runMutationReadRule(
      `import { useCallback } from "react";
       function Component() {
         const handleResponse = useCallback((response) => setUser(response.user), []);
         const { mutate: fetchUser } = useMutation({ mutationFn, onSuccess: handleResponse });
         useEffect(() => { fetchUser(params); }, [params]);
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags digit-separated read intent names", () => {
    const result = runMutationReadRule(
      `function Component() {
         const { mutateAsync: get2FA } = useMutation(options);
         useEffect(() => {
           void get2FA(params).then((response) => setChallenge(response.challenge));
         }, [params]);
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

  it("flags calls through mutation method and result aliases", () => {
    const destructured = runMutationReadRule(
      `function Component() {
         const { mutateAsync: fetchUser, data } = useMutation(options);
         const requestUser = fetchUser;
         useEffect(() => { requestUser(params); }, [params]);
         return <div>{data.user.name}</div>;
       }`,
    );
    const wholeResult = runMutationReadRule(
      `function Component() {
         const fetchUserMutation = useMutation(options);
         const aliasedMutation = fetchUserMutation;
         useEffect(() => { aliasedMutation.mutate(params); }, [params]);
         return <div>{aliasedMutation.data.user.name}</div>;
       }`,
    );
    expect(destructured.diagnostics).toHaveLength(1);
    expect(wholeResult.diagnostics).toHaveLength(1);
  });

  it("flags aliased and conditional effect callbacks", () => {
    const aliased = runMutationReadRule(
      `function Component() {
         const { mutateAsync: fetchUser, data } = useMutation(options);
         const loadUser = () => { fetchUser(params); };
         const aliasedLoadUser = loadUser;
         useEffect(aliasedLoadUser, [params]);
         return <div>{data.user.name}</div>;
       }`,
    );
    const conditional = runMutationReadRule(
      `function Component() {
         const { mutateAsync: fetchUser, data } = useMutation(options);
         const loadUser = () => { fetchUser(params); };
         useEffect(enabled ? loadUser : undefined, [enabled, params]);
         return <div>{data.user.name}</div>;
       }`,
    );
    expect(aliased.diagnostics).toHaveLength(1);
    expect(conditional.diagnostics).toHaveLength(1);
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

  it("does not accept a run-once ref latch reset by cleanup", () => {
    const result = runMutationReadRule(
      `import { useRef } from "react";
       function Component() {
         const { mutateAsync: fetchUser } = useMutation(options);
         const handled = useRef(false);
         useEffect(() => {
           if (handled.current) return;
           handled.current = true;
           void fetchUser(params).then((response) => setUser(response.user));
           return () => { handled.current = false; };
         }, [params]);
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
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

  it("accepts dominating guards through destructured status aliases", () => {
    const successAlias = runMutationReadRule(
      `function Component() {
         const { mutateAsync: fetchUser, data, isSuccess } = useMutation(options);
         const didLoadUser = isSuccess;
         useEffect(() => {
           if (didLoadUser) return;
           fetchUser(params);
         }, [didLoadUser, params]);
         return <div>{data.user.name}</div>;
       }`,
    );
    const statusAlias = runMutationReadRule(
      `function Component() {
         const { mutateAsync: fetchUser, data, status } = useMutation(options);
         const userStatus = status;
         useEffect(() => {
           if (userStatus === "success") return;
           fetchUser(params);
         }, [params, userStatus]);
         return <div>{data.user.name}</div>;
       }`,
    );
    const dataAlias = runMutationReadRule(
      `function Component() {
         const { mutateAsync: fetchUser, data } = useMutation(options);
         const loadedUser = data;
         useEffect(() => {
           if (loadedUser !== undefined) return;
           fetchUser(params);
         }, [loadedUser, params]);
         return <div>{data.user.name}</div>;
       }`,
    );
    expect(successAlias.diagnostics).toHaveLength(0);
    expect(statusAlias.diagnostics).toHaveLength(0);
    expect(dataAlias.diagnostics).toHaveLength(0);
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

  it("does not accept a truthy data guard as proof of a completed read", () => {
    const result = runMutationReadRule(
      `function Component() {
         const { mutateAsync: fetchCount, data } = useMutation(options);
         useEffect(() => {
           if (data) return;
           void fetchCount(params).then((response) => setCount(response.count));
         }, [data, params]);
         return <output>{data}</output>;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a nullish data-availability guard", () => {
    const result = runMutationReadRule(
      `function Component() {
         const { mutateAsync: fetchCount, data } = useMutation(options);
         useEffect(() => {
           if (data !== undefined) return;
           void fetchCount(params).then((response) => setCount(response.count));
         }, [data, params]);
         return <output>{data}</output>;
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

  it("stays silent when list is the object of a write-intent name", () => {
    const result = runMutationReadRule(
      `function Component() {
         const { mutateAsync: updateList, data } = useMutation(options);
         useEffect(() => { updateList(params); }, [params]);
         return <div>{data.items.length}</div>;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays silent on check-in and check-out write-intent names", () => {
    const checkOut = runMutationReadRule(
      `function Component() {
         const { mutateAsync: checkOutBook, data } = useMutation(options);
         useEffect(() => { checkOutBook(bookId); }, [bookId]);
         return <div>{data.receiptId}</div>;
       }`,
    );
    const checkIn = runMutationReadRule(
      `function Component() {
         const { mutateAsync: checkInBook, data } = useMutation(options);
         useEffect(() => { checkInBook(bookId); }, [bookId]);
         return <div>{data.receiptId}</div>;
       }`,
    );
    expect(checkOut.diagnostics).toHaveLength(0);
    expect(checkIn.diagnostics).toHaveLength(0);
  });

  it("keeps list as a leading read-intent verb", () => {
    const result = runMutationReadRule(
      `function Component() {
         const { mutateAsync: listUsers, data } = useMutation(options);
         useEffect(() => { listUsers(params); }, [params]);
         return <div>{data.users.length}</div>;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
