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

  it("recognizes aliased React effect imports", () => {
    const result = runMutationReadRule(
      `import { useEffect as runEffect } from "react";
       const getUser = useMutation(options);
       runEffect(() => getUser.mutate(userId), [userId]);
       const view = getUser.data?.name;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent on a local effect-like function", () => {
    const result = runMutationReadRule(
      `const useEffect = (callback) => callback();
       const getUser = useMutation(options);
       useEffect(() => getUser.mutate(userId));
       const view = getUser.data?.name;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("detects mutation calls through deferred method bindings", () => {
    const destructured = runMutationReadRule(
      `const getUser = useMutation(options);
       const { mutate } = getUser;
       useEffect(() => mutate(userId), [userId]);
       const view = getUser.data?.name;`,
    );
    const memberAlias = runMutationReadRule(
      `const getUser = useMutation(options);
       const requestUser = getUser.mutate;
       useEffect(() => requestUser(userId), [userId]);
       const view = getUser.data?.name;`,
    );
    expect(destructured.diagnostics).toHaveLength(1);
    expect(memberAlias.diagnostics).toHaveLength(1);
  });

  it.each([
    [
      "whole-result member access",
      `const fetchUserMutation = useMutation(options);
       useEffect(() => { (fetchUserMutation as MutationResult).mutate(userId); }, [userId]);
       const user = (fetchUserMutation as MutationResult).data?.user;`,
    ],
    [
      "whole-result destructuring",
      `const fetchUserMutation = useMutation(options);
       const { mutate, data } = fetchUserMutation as MutationResult;
       useEffect(() => { mutate(userId); }, [userId]);
       const user = data?.user;`,
    ],
    [
      "deferred method binding",
      `const fetchUserMutation = useMutation(options);
       const requestUser = fetchUserMutation!.mutate as MutationFunction;
       useEffect(() => { (requestUser as MutationFunction)(userId); }, [userId]);
       const user = fetchUserMutation!.data?.user;`,
    ],
  ])("detects TypeScript-wrapped %s", (_wrapperName, source) => {
    const result = runMutationReadRule(source);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("detects calls through TypeScript-wrapped effect helpers", () => {
    const result = runMutationReadRule(
      `const fetchUserMutation = useMutation(options);
       const loadUser = () => fetchUserMutation.mutate(userId);
       const runLoadEffect = () => { (loadUser as () => void)(); };
       useEffect(runLoadEffect, [userId]);
       const user = fetchUserMutation.data?.user;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("detects response consumption in per-call success options", () => {
    const result = runMutationReadRule(
      `const getUser = useMutation(options);
       useEffect(() => {
         getUser.mutate(userId, { onSuccess: (data) => setUser(data) });
       }, [userId]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("detects response consumption in mutation settled options", () => {
    const result = runMutationReadRule(
      `const getUser = useMutation({
         mutationFn: fetchUser,
         onSettled: (data) => setUser(data),
       });
       useEffect(() => getUser.mutate(userId), [userId]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("uses the mutation function name as read intent", () => {
    const result = runMutationReadRule(
      `const mutation = useMutation({ mutationFn: fetchUser });
       useEffect(() => mutation.mutate(userId), [userId]);
       const view = mutation.data?.name;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not infer read intent from an opaque options binding", () => {
    const result = runMutationReadRule(
      `import { fetchMutationOptions } from "./mutation-options";
       const mutation = useMutation(fetchMutationOptions);
       useEffect(() => mutation.mutate(userId), [userId]);
       const view = mutation.data?.name;`,
    );
    expect(result.diagnostics).toHaveLength(0);
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

  it("flags response consumption through a TypeScript-wrapped then method", () => {
    const result = runMutationReadRule(
      `const { mutateAsync: fetchUser } = useMutation(options);
       useEffect(() => {
         void fetchUser(userId).then!((response) => setUser(response.user));
       }, [userId]);`,
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

  it("ignores data references in TypeScript-wrapped effect dependencies", () => {
    const result = runMutationReadRule(
      `const { mutateAsync: fetchUser, data } = useMutation(options);
       useEffect(() => { fetchUser(params); }, [params, data] as const);`,
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

  it.each([
    ["wrapped ref on the left", `(handled.current as boolean) === (true as const)`],
    ["wrapped ref on the right", `(true as const) === (handled.current as boolean)`],
  ])("accepts TypeScript-wrapped run-once latch booleans with %s", (_caseName, guard) => {
    const result = runMutationReadRule(
      `import { useRef } from "react";
       const { mutateAsync: fetchUser } = useMutation(options);
       const handled = useRef(false);
       useEffect(() => {
         if (${guard}) return;
         handled.current = true as boolean;
         void fetchUser(params).then((response) => setUser(response.user));
       }, [params]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a dominating block-form run-once ref latch", () => {
    const result = runMutationReadRule(
      `import { useRef } from "react";
       const { mutateAsync: fetchUser } = useMutation(options);
       const handled = useRef(false);
       useEffect(() => {
         if (!((handled as RefObject<boolean>).current as boolean)) {
           (handled as RefObject<boolean>).current = true as boolean;
           void fetchUser(params).then((response) => setUser(response.user));
         }
       }, [params]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    ["direct positive", "handled.current", true],
    ["unary negative", "!handled.current", false],
    ["loose equality with true", "handled.current == true", true],
    ["strict equality with true", "true === handled.current", true],
    ["loose inequality with false", "handled.current != false", true],
    ["strict inequality with false", "false !== handled.current", true],
    ["loose equality with false", "handled.current == false", false],
    ["strict equality with false", "false === handled.current", false],
    ["loose inequality with true", "handled.current != true", false],
    ["strict inequality with true", "true !== handled.current", false],
  ])("recognizes %s ref latch polarity", (_caseName, guard, isPositiveGuard) => {
    const earlyExitResult = runMutationReadRule(
      `import { useRef } from "react";
         const { mutateAsync: fetchUser } = useMutation(options);
         const handled = useRef(false);
         useEffect(() => {
           if (${guard}) return;
           handled.current = true;
           void fetchUser(params).then((response) => setUser(response.user));
         }, [params]);`,
    );
    expect(earlyExitResult.diagnostics).toHaveLength(isPositiveGuard ? 0 : 1);

    const blockResult = runMutationReadRule(
      `import { useRef } from "react";
         const { mutateAsync: fetchUser } = useMutation(options);
         const handled = useRef(false);
         useEffect(() => {
           if (${guard}) {
             handled.current = true;
             void fetchUser(params).then((response) => setUser(response.user));
           }
         }, [params]);`,
    );
    expect(blockResult.diagnostics).toHaveLength(isPositiveGuard ? 1 : 0);
  });

  it.each([
    [
      "missing assignment",
      `if (!handled.current) {
         void fetchUser(params).then((response) => setUser(response.user));
       }`,
    ],
    [
      "assignment after the mutation",
      `if (!handled.current) {
         void fetchUser(params).then((response) => setUser(response.user));
         handled.current = true;
       }`,
    ],
    [
      "mutation in the alternate branch",
      `if (!handled.current) {
         handled.current = true;
       } else {
         void fetchUser(params).then((response) => setUser(response.user));
       }`,
    ],
  ])("does not accept a block-form latch with %s", (_caseName, effectBody) => {
    const result = runMutationReadRule(
      `import { useRef } from "react";
       const { mutateAsync: fetchUser } = useMutation(options);
       const handled = useRef(false);
       useEffect(() => { ${effectBody} }, [params]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
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

  it("does not accept a TypeScript-wrapped ref latch reset", () => {
    const result = runMutationReadRule(
      `import { useRef } from "react";
       const { mutateAsync: fetchUser } = useMutation(options);
       const handled = useRef(false);
       useEffect(() => {
         if (handled.current) return;
         handled.current = true;
         void fetchUser(params).then((response) => setUser(response.user));
         return () => { (handled as RefObject<boolean>).current = false; };
       }, [params]);`,
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

  it.each([
    ["isSuccess", `(isSuccess as boolean) === (true as const)`],
    ["status", `(status as string) === ("success" as const)`],
  ])("accepts a TypeScript-wrapped %s status guard", (_guardName, guardExpression) => {
    const result = runMutationReadRule(
      `const { mutateAsync: fetchUser, data, isSuccess, status } = useMutation(options);
       useEffect(() => {
         if (${guardExpression}) return;
         fetchUser(params);
       }, [isSuccess, params, status]);
       const user = data?.user;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    ["status", `!((status as string) !== ("success" as const))`],
    ["data", `!((data as User | undefined) === undefined)`],
  ])(
    "accepts a negated %s comparison as a dominating early exit",
    (_guardName, guardExpression) => {
      const result = runMutationReadRule(
        `const { mutateAsync: fetchUser, data, status } = useMutation(options);
       useEffect(() => {
         if (${guardExpression}) return;
         fetchUser(params);
       }, [data, params, status]);
       const user = data?.user;`,
      );
      expect(result.diagnostics).toHaveLength(0);
    },
  );

  it.each([
    ["isSuccess", `(isSuccess as boolean) === (false as const)`],
    ["status", `(status as string) === ("pending" as const)`],
  ])("does not accept a mismatched wrapped %s status guard", (_guardName, guardExpression) => {
    const result = runMutationReadRule(
      `const { mutateAsync: fetchUser, data, isSuccess, status } = useMutation(options);
       useEffect(() => {
         if (${guardExpression}) return;
         fetchUser(params);
       }, [isSuccess, params, status]);
       const user = data?.user;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["negated isSuccess", `!(isSuccess as boolean)`],
    ["false isSuccess equality", `(isSuccess as boolean) === (false as const)`],
    ["true isSuccess inequality", `(isSuccess as boolean) !== (true as const)`],
    ["loose status inequality", `(status as string) != ("success" as const)`],
    ["strict status inequality", `(status as string) !== ("success" as const)`],
    ["loose nullish data equality", `(data as User | null | undefined) == null`],
    ["strict undefined data equality", `(data as User | undefined) === undefined`],
    ["negated successful status equality", `!((status as string) === ("success" as const))`],
    ["negated present data inequality", `!((data as User | undefined) !== undefined)`],
  ])("accepts an enclosing %s branch", (_guardName, guardExpression) => {
    const result = runMutationReadRule(
      `const { mutateAsync: fetchUser, data, isSuccess, status } = useMutation(options);
       useEffect(() => {
         if (${guardExpression}) {
           fetchUser(params);
         }
       }, [data, isSuccess, params, status]);
       const user = data?.user;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    ["positive isSuccess", `isSuccess`],
    ["true isSuccess equality", `isSuccess === true`],
    ["successful status equality", `status === "success"`],
    ["present data inequality", `data !== undefined`],
  ])("does not accept an enclosing %s branch", (_guardName, guardExpression) => {
    const result = runMutationReadRule(
      `const { mutateAsync: fetchUser, data, isSuccess, status } = useMutation(options);
       useEffect(() => {
         if (${guardExpression}) {
           fetchUser(params);
         }
       }, [data, isSuccess, params, status]);
       const user = data?.user;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not accept the alternate branch of an inverted status guard", () => {
    const result = runMutationReadRule(
      `const { mutateAsync: fetchUser, data, isSuccess } = useMutation(options);
       useEffect(() => {
         if (!isSuccess) {
           trackPending();
         } else {
           fetchUser(params);
         }
       }, [isSuccess, params]);
       const user = data?.user;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a dominating void-zero data guard", () => {
    const result = runMutationReadRule(
      `function Component() {
         const { mutateAsync: fetchUser, data } = useMutation(options);
         useEffect(() => {
           if (data !== void 0) return;
           fetchUser(params);
         }, [data, params]);
         return <div>{data?.user.name}</div>;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat a void-zero comparison as consuming response data", () => {
    const result = runMutationReadRule(
      `function Component() {
         const { mutateAsync: fetchUser, data } = useMutation(options);
         useEffect(() => { fetchUser(params); }, [params]);
         return data !== void 0;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    ["raw test", "data"],
    ["parenthesized test", "(data)"],
    ["TypeScript as test", "data as { user: unknown } | undefined"],
    ["TypeScript satisfies test", "data satisfies { user: unknown } | undefined"],
    ["TypeScript non-null test", "data!"],
    ["unary negation", "!data"],
    ["global Boolean coercion", "Boolean(data)"],
    ["logical-and test", "data && ready"],
    ["logical-or propagated test", "data || ready"],
    ["nullish-coalesce propagated test", "data ?? ready"],
    ["conditional test", "data ? ready : false"],
    ["conditional branch propagated to a test", "enabled ? data : false"],
    ["nullish equality", "data !== undefined"],
    ["final sequence test", "(track(), data)"],
    ["non-final discarded sequence", "(data, ready)"],
  ])("keeps %s guard-only", (_guardName, guardExpression) => {
    const result = runMutationReadRule(
      `function Component() {
         const { mutateAsync: fetchUser, data } = useMutation(options);
         useEffect(() => { fetchUser(params); }, [params]);
         return (${guardExpression}) ? <Ready /> : null;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    ["unary negation", "!data"],
    ["global Boolean coercion", "Boolean(data)"],
    ["logical-and left operand", "data && ready"],
    ["conditional test", "data ? ready : fallback"],
    ["nullish equality", "data !== undefined"],
    ["non-final sequence operand", "(data, ready)"],
  ])("keeps %s guard-only in a value position", (_guardName, guardExpression) => {
    const result = runMutationReadRule(
      `function Component() {
         const { mutateAsync: fetchUser, data } = useMutation(options);
         useEffect(() => { fetchUser(params); }, [params]);
         return <Output value={${guardExpression}} />;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    ["raw value", "data"],
    ["parenthesized value", "(data)"],
    ["TypeScript as value", "data as { user: unknown }"],
    ["TypeScript satisfies value", "data satisfies { user: unknown } | undefined"],
    ["TypeScript non-null value", "data!"],
    ["optional-chain value", "data?.user"],
    ["logical-or value", "data || fallback"],
    ["nullish-coalesce value", "data ?? fallback"],
    ["conditional branch value", "enabled ? data : fallback"],
    ["non-nullish equality value", "data === otherData"],
    ["final sequence value", "(track(), data)"],
  ])("detects %s consumption", (_consumerName, consumerExpression) => {
    const result = runMutationReadRule(
      `function Component() {
         const { mutateAsync: fetchUser, data } = useMutation(options);
         useEffect(() => { fetchUser(params); }, [params]);
         return <Output value={${consumerExpression}} />;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("treats a shadowed Boolean call as value consumption", () => {
    const result = runMutationReadRule(
      `function Component() {
         const { mutateAsync: fetchUser, data } = useMutation(options);
         const Boolean = (value) => value;
         useEffect(() => { fetchUser(params); }, [params]);
         return <Output value={Boolean(data)} />;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    [
      "wrapped do-while test",
      `do {
          track();
        } while ((data as { user: unknown } | undefined));`,
    ],
    [
      "wrapped for test",
      `for (; (data satisfies { user: unknown } | undefined); ) {
          track();
        }`,
    ],
  ])("keeps a %s guard-only", (_guardName, loopStatement) => {
    const result = runMutationReadRule(
      `function Component() {
         const { mutateAsync: fetchUser, data } = useMutation(options);
         useEffect(() => { fetchUser(params); }, [params]);
         ${loopStatement}
         return null;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    [
      "do-while body",
      `do {
          consume(data as { user: unknown });
        } while (enabled);`,
    ],
    [
      "for body",
      `for (; enabled; ) {
          consume(data!);
        }`,
    ],
  ])("detects wrapped data consumption in a %s", (_consumerName, loopStatement) => {
    const result = runMutationReadRule(
      `function Component() {
         const { mutateAsync: fetchUser, data } = useMutation(options);
         useEffect(() => { fetchUser(params); }, [params]);
         ${loopStatement}
         return null;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
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

  it.each(["undefined as unknown", "null satisfies null"])(
    "accepts a wrapped %s data-availability guard",
    (nullishExpression) => {
      const result = runMutationReadRule(
        `function Component() {
           const { mutateAsync: fetchCount, data } = useMutation(options);
           useEffect(() => {
             if (data !== (${nullishExpression})) return;
             void fetchCount(params).then((response) => setCount(response.count));
           }, [data, params]);
           return <output>{data}</output>;
         }`,
      );
      expect(result.diagnostics).toHaveLength(0);
    },
  );

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

  it.each([
    ["conditional", "enabled ? () => { fetchUser(params); } : undefined"],
    ["logical", "enabled && (() => { fetchUser(params); })"],
    ["TypeScript", "(() => { fetchUser(params); }) as () => void"],
  ])("detects a wrapped inline %s effect callback", (_wrapperName, callback) => {
    const result = runMutationReadRule(
      `function Component() {
         const { mutateAsync: fetchUser, data } = useMutation(options);
         useEffect(${callback}, [enabled, params]);
         return <div>{data.user.name}</div>;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["TypeScript assertion", "(fetchUserMutation as any).mutate(params)"],
    ["non-null assertion", "fetchUserMutation!.mutate(params)"],
  ])("detects a mutation call through a %s receiver", (_wrapperName, mutationCall) => {
    const result = runMutationReadRule(
      `function Component() {
         const fetchUserMutation = useMutation(options);
         useEffect(() => { ${mutationCall}; }, [params]);
         return <div>{fetchUserMutation.data.user.name}</div>;
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
