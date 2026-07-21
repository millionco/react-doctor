import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { __clearParseSourceFileCacheForTests } from "../../utils/parse-source-file.js";
import { noLoadingFlagResetOutsideFinally } from "./no-loading-flag-reset-outside-finally.js";

const STRESS_SITE_COUNT = 1_600;

describe("no-loading-flag-reset-outside-finally", () => {
  it("flags a trailing reset with no try/catch at all", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const load = async () => {
        setIsLoading(true);
        const result = await getTrashPaginated(page, perPage);
        setItems(result.items);
        setIsLoading(false);
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when a swallowing catch makes the trailing reset run on rejection too (setError-in-catch idiom)", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `async function fetchNetworkAnalysis() {
        setLoading(true);
        try {
          const data = await load(dataId);
          setResult(data);
        } catch (e) {
          setError(e);
        }
        setLoading(false);
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a trailing reset when the catch rethrows, so rejection still skips it", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const save = async () => {
        setSaving(true);
        try {
          await persist(draft);
        } catch (e) {
          reportError(e);
          throw e;
        }
        setSaving(false);
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a trailing reset when the catch returns early, so rejection still skips it", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const save = async () => {
        setSaving(true);
        try {
          await persist(draft);
        } catch (e) {
          reportError(e);
          return;
        }
        setSaving(false);
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a reset inside the try body even when the catch swallows", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const load = async () => {
        setLoading(true);
        try {
          const data = await fetchData();
          setResult(data);
          setLoading(false);
        } catch (e) {
          setError(e);
        }
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a submit handler that resets only after the awaited mutation", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const onSubmit = async () => {
        setSubmitting(true);
        await savePlugin(values);
        onClose();
        setSubmitting(false);
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when the reset is mirrored in the catch", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const search = async (query) => {
        setLoading(true);
        try {
          const res = await autocomplete(query);
          setResults(res);
          setLoading(false);
        } catch (e) {
          setLoading(false);
          reportError(e);
        }
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the reset is in a finally", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const submit = async () => {
        setSubmitting(true);
        try {
          await placeBid(input);
        } finally {
          setSubmitting(false);
        }
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when an effect cleanup lifecycle guard wraps a reset in finally", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useEffect, useState } from "react";
       const Preview = () => {
         const [, setIsLoading] = useState(false);
         useEffect(() => {
           let isMounted = true;
           const load = async () => {
             setIsLoading(true);
             try { await fetchFeed(); }
             finally { if (isMounted) setIsLoading(false); }
           };
           load();
           return () => { isMounted = false; };
         }, []);
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a cleanup-backed mounted ref guard in finally", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useEffect, useRef, useState } from "react";
       const Preview = () => {
         const [, setIsLoading] = useState(false);
         const mountedRef = useRef(true);
         useEffect(() => {
           const load = async () => {
             setIsLoading(true);
             try { await fetchFeed(); }
             finally { if (mountedRef.current) setIsLoading(false); }
           };
           load();
           return () => { mountedRef.current = false; };
         }, []);
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a conditional finally reset without a matching effect cleanup guard", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useState } from "react";
       const Preview = () => {
         const [, setIsLoading] = useState(false);
         const load = async () => {
           setIsLoading(true);
           try { await fetchFeed(); }
           finally { if (shouldReset) setIsLoading(false); }
         };
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trust a shadowed useEffect as lifecycle cleanup proof", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useState } from "react";
       const useEffect = (callback) => callback();
       const Preview = () => {
         const [, setIsLoading] = useState(false);
         useEffect(() => {
           let isMounted = true;
           const load = async () => {
             setIsLoading(true);
             try { await fetchFeed(); }
             finally { if (isMounted) setIsLoading(false); }
           };
           return () => { isMounted = false; };
         });
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("requires a lifecycle guard to start active and wrap a finalizer reset", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useEffect, useState } from "react";
       const Preview = () => {
         const [, setIsLoading] = useState(false);
         useEffect(() => {
           let firstMounted = false;
           const firstLoad = async () => {
             setIsLoading(true);
             try { await fetchFeed(); }
             finally { if (firstMounted) setIsLoading(false); }
           };
           const secondLoad = async () => {
             let secondMounted = true;
             setIsLoading(true);
             try { await fetchFeed(); }
             catch (error) {
               if (secondMounted) setIsLoading(false);
               throw error;
             }
           };
           firstLoad();
           secondLoad();
           return () => {
             firstMounted = false;
             secondMounted = false;
           };
         }, []);
       };`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not trust lifecycle guards written outside the returned cleanup", () => {
    const sources = [
      `import { useEffect, useState } from "react";
       const Preview = () => {
         const [, setIsLoading] = useState(false);
         useEffect(() => {
           let isMounted = true;
           isMounted = false;
           const load = async () => {
             setIsLoading(true);
             try { await fetchFeed(); }
             finally { if (isMounted) setIsLoading(false); }
           };
           load();
           return () => { isMounted = false; };
         }, []);
       };`,
      `import { useEffect, useRef, useState } from "react";
       const Preview = () => {
         const [, setIsLoading] = useState(false);
         const mountedRef = useRef(true);
         useEffect(() => {
           mountedRef.current = false;
           const load = async () => {
             setIsLoading(true);
             try { await fetchFeed(); }
             finally { if (mountedRef.current) setIsLoading(false); }
           };
           load();
           return () => { mountedRef.current = false; };
         }, []);
       };`,
    ];
    for (const source of sources) {
      expect(runRule(noLoadingFlagResetOutsideFinally, source).diagnostics).toHaveLength(1);
    }
  });

  it("stays quiet for a non-loading boolean toggle", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const toggle = async () => {
        setOpen(true);
        await animate();
        setOpen(false);
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when there is no await between set and reset", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const load = () => {
        setLoading(true);
        doWork();
        setLoading(false);
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat a nested callback reset as this scope's reset", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const load = async () => {
        setLoading(true);
        await fetchThings();
        subscribe(() => {
          setLoading(false);
        });
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the reset happens before the await", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const load = async () => {
        setLoading(true);
        setLoading(false);
        await fetchThings();
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for await Promise.allSettled, which never rejects by spec", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const loadAll = async () => {
        const requests = [];
        setLoading(true);
        const results = await Promise.allSettled(requests);
        setItems(results);
        setLoading(false);
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for the fetch-with-fallback idiom await f().catch(() => null)", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const load = async () => {
        setLoading(true);
        const data = await fetchThings().catch(() => null);
        setItems(data ?? []);
        setLoading(false);
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a checked result object because the underlying promise can still reject", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const remove = async () => {
        setIsDeleting(true);
        const result = await deleteWorkspace(workspaceId);
        if (!result.success) {
          setError(result.message);
        }
        setIsDeleting(false);
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a truthiness-checked result because the underlying promise can still reject", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const invite = async () => {
        setSending(true);
        const response = await sendInvites(emails);
        if (!response) {
          showError();
        }
        setSending(false);
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a destructured error result because the underlying promise can still reject", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const load = async () => {
        setLoading(true);
        const { data, error } = await supabase.from("posts").select();
        if (error) {
          setError(error);
        }
        setItems(data);
        setLoading(false);
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags when the awaited result is used without any error-shape check", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const load = async () => {
        setLoading(true);
        const result = await getSurveyData(surveyId);
        setSurvey(result.survey);
        setLoading(false);
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when the truthy set and the reset sit on mutually exclusive if/else branches", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const toggle = async (next) => {
        if (next) {
          setLoading(true);
          await start();
        } else {
          await stop();
          setLoading(false);
        }
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags Promise.all even when its result shape is checked", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const handleConfirmBulkDelete = async () => {
        setIsBulkDeleting(true);
        const ids = Array.from(selectedIds);
        const results = await Promise.all(ids.map((id) => deleteProject(id, false)));
        const failures = results.filter((r) => !r.success);
        setIsBulkDeleting(false);
        if (failures.length === 0) {
          toast.success("moved");
        } else {
          toast.error(failures[0]?.error);
        }
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a result checked with some because the call can still reject", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const submitAll = async () => {
        setSubmitting(true);
        const outcomes = await submitBatch(entries);
        const didAnyFail = outcomes.some((outcome) => outcome.error);
        setSubmitting(false);
        if (didAnyFail) showError();
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags when the array callback checks a property outside the result shape", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const loadPhotos = async (searchValue) => {
        setLoading(true);
        const results = await Promise.all(requests);
        setLoading(false);
        const photos = results.flatMap((result) => {
          if (result.errors) {
            setError(result.errors[0]);
            return [];
          }
          return result.response.results;
        });
        setPhotos(photos);
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a Promise.all await whose result is consumed without any result-shape check", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const preview = async () => {
        setFetching(true);
        const [html, text] = await Promise.all([fetchHtml(id), fetchText(id)]);
        setPreviews({ html, text });
        setFetching(false);
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an unprotected await between the set and the reset even when an earlier await gates the set", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const submit = async () => {
        const ok = await validate(values);
        if (!ok) return;
        setSubmitting(true);
        await save(values);
        setSubmitting(false);
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet: Cancelled-flag effect fetch with `if (cancelled) return` guards in catch", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const Profile = ({ url }) => {
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const response = await fetch(url);
        const data = await response.json();
        if (cancelled) return;
        setData(data);
      } catch (error) {
        if (cancelled) return;
        setError(error);
      }
      setLoading(false);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [url]);
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: AbortController effect with AbortError early-return in catch", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const Results = ({ query }) => {
  useEffect(() => {
    const controller = new AbortController();
    const run = async () => {
      setFetching(true);
      try {
        const response = await fetch("/api/search?q=" + query, { signal: controller.signal });
        const payload = await response.json();
        setResults(payload.items);
      } catch (error) {
        if (error.name === "AbortError") return;
        setError(error);
      }
      setFetching(false);
    };
    run();
    return () => controller.abort();
  }, [query]);
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Pure-delay cooldown await (resolve-only Promise executor)", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const ResendCodeButton = ({ onResend }) => {
  const handleResend = async () => {
    setResendDisabled(true);
    onResend();
    await new Promise((resolve) => setTimeout(resolve, 30000));
    setResendDisabled(false);
  };
  return <button disabled={resendDisabled} onClick={handleResend}>Resend</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: In-file sleep() helper between set and reset", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const DemoForm = () => {
  const submit = async () => {
    setSubmitting(true);
    await sleep(800);
    setSubmitting(false);
    setDone(true);
  };
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: In-file never-rejecting safe-fetch helper (errors folded to null)", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const fetchItemsSafely = async () => {
  try {
    const response = await fetch("/api/items");
    return await response.json();
  } catch {
    return null;
  }
};

const ItemList = () => {
  const load = async () => {
    setLoading(true);
    const items = await fetchItemsSafely();
    setItems(items ?? []);
    setLoading(false);
  };
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Go-style [error, data] tuple via in-file to() wrapper (await-to-js idiom)", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const to = (promise) => promise.then((data) => [null, data]).catch((error) => [error, null]);

const SaveButton = () => {
  const handleSave = async () => {
    setSaving(true);
    const [error, saved] = await to(persistDraft(draft));
    if (error) {
      setErrorMessage(error.message);
    } else {
      onSaved(saved);
    }
    setSaving(false);
  };
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Redux Toolkit createAsyncThunk dispatch checked via .match()", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const UsersPanel = () => {
  const loadUsers = async (searchTerm) => {
    setLoading(true);
    const action = await dispatch(fetchUsers(searchTerm));
    if (fetchUsers.fulfilled.match(action)) {
      setUsers(action.payload);
    } else {
      setLoadError(action.error);
    }
    setLoading(false);
  };
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a ternary-consumed error result because the call can still reject", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const ProfileForm = () => {
  const handleSave = async () => {
    setSaving(true);
    const { error } = await supabase.from("profiles").update({ displayName }).eq("id", userId);
    setStatusMessage(error ? error.message : "Saved");
    setSaving(false);
  };
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet: Switch-case mutually exclusive branches (start sets, cancel resets)", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const handleAction = async (action) => {
  switch (action) {
    case "start":
      setProcessing(true);
      await beginJob();
      break;
    case "cancel":
      await cancelJob();
      setProcessing(false);
      break;
  }
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Redux ActionResult checked via result?.data with else branch (mattermost wild-hit shape)", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const TestModal = () => {
  const fetchUsersPage = async (term) => {
    setLoading(true);
    const result = await dispatch(searchUsers(term));
    if (result?.data) {
      setUsers(result.data.users);
    } else {
      setUsers([]);
    }
    setLoading(false);
  };
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags Promise.all results checked per-element because an input can reject", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const handleBulkDelete = async () => {
  setDeleting(true);
  const results = await Promise.all(selectedIds.map((id) => removeItem(id)));
  const failures = [];
  for (const entry of results) {
    if (!entry.success) failures.push(entry.error);
  }
  setDeleting(false);
  if (failures.length > 0) toast.error(failures[0]);
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet: Promise.all over an array literal where every element carries its own .catch fallback", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const refresh = async () => {
        setLoading(true);
        const [cols, images, videos] = await Promise.all([
          listMediaCollections().catch(() => []),
          listImageGallery().catch(() => []),
          listVideoHistory().catch(() => []),
        ]);
        setCollections(cols);
        setLoading(false);
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Promise.all element with a .then(...).catch(...) chain still counts as rejection-handled", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const refresh = async () => {
        setLoading(true);
        const [instances, subs] = await Promise.all([
          getInstances({ silent: true }).catch(() => null),
          listPeerSubscriptions({ recordId })
            .then((r) => r?.subscriptions || [])
            .catch(() => []),
        ]);
        setPeers(instances?.peers || []);
        setSubscriptions(subs);
        setLoading(false);
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: bare Redux thunk dispatch await (rejection folds into the resolved action)", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const onStopSharing = async () => {
        setIsLoading(true);
        await dispatch(sharedThunks.stopSharingItem({ itemId }));
        onClose();
        setIsLoading(false);
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a dispatch await that is .unwrap()ed (unwrap rethrows the rejection)", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const onStopSharing = async () => {
        setIsLoading(true);
        await dispatch(sharedThunks.stopSharingItem({ itemId })).unwrap();
        setIsLoading(false);
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a guarded same-file helper with opaque synchronous calls", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const TasteTab = () => {
        const loadProfile = useCallback(async () => {
          const data = await api.getTasteProfile().catch(() => null);
          if (data) setProfile(data);
          setLoading(false);
        }, []);
        const submitAnswer = async () => {
          setSubmitting(true);
          const result = await api.submitTasteAnswer(answer).catch(() => null);
          if (!result) {
            toast.error("Failed to save response");
            setSubmitting(false);
            return;
          }
          await loadProfile();
          setSubmitting(false);
        };
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an await of a same-file helper whose own await is unguarded", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const Tab = () => {
        const loadPublished = async () => {
          const rows = await api.getAgentPublished(agentId);
          setRows(rows);
        };
        const refresh = async () => {
          setPublishedLoading(true);
          await loadPublished();
          setPublishedLoading(false);
        };
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trust a reassigned same-file helper initializer", () => {
    const variableHelper = runRule(
      noLoadingFlagResetOutsideFinally,
      `let request = async () => { try { await fetch("/safe"); } catch {} }; request = async () => fetch("/unsafe"); const load = async () => { setLoading(true); await request(); setLoading(false); };`,
    );
    const functionHelper = runRule(
      noLoadingFlagResetOutsideFinally,
      `async function request() { try { await fetch("/safe"); } catch {} } request = async () => fetch("/unsafe"); const load = async () => { setLoading(true); await request(); setLoading(false); };`,
    );
    expect(variableHelper.diagnostics).toHaveLength(1);
    expect(functionHelper.diagnostics).toHaveLength(1);
  });

  it("flags Promise-array setup performed through an opaque iterator call", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const ShareInviteDialog = (props) => {
        const processInvites = async (usersToInvite) => {
          const sharingPromises = [];
          usersToInvite.forEach((user) => {
            sharingPromises.push(
              dispatch(sharedThunks.shareItemWithUser({ sharedWith: user.email })),
            );
          });
          await Promise.all(sharingPromises);
        };
        const onInvite = async () => {
          setIsAnyInviteLoading(true);
          await processInvites(usersToInvite);
          setIsAnyInviteLoading(false);
          props.onClose();
        };
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["opaque member call", `risk.run();`],
    ["setter-like call", `setDangerous();`],
    ["dispatch-like call", `dangerousDispatch();`],
    ["invalid queueMicrotask call", `queueMicrotask();`],
  ])("flags a guarded helper containing an unproven %s", (_shape, statement) => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const guarded = async () => {
        ${statement}
        try { await request(); } catch {}
      };
      const load = async () => {
        setLoading(true);
        await guarded();
        setLoading(false);
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags Promise.all over an array populated with unguarded request pushes", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const loadPhotos = async (searchValue) => {
        setLoading(true);
        const requests = [];
        pages.forEach((page) => {
          requests.push(unsplash.search.getPhotos({ query: searchValue, page }));
        });
        const results = await Promise.all(requests);
        setPhotos(results);
        setLoading(false);
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an error-in-result check because either conditional await can reject", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const handleDraftSave = async () => {
        setDraftSaving(true);
        const result = editingId
          ? await updateSkill(editingId, payload)
          : await importSkill(payload);
        setDraftSaving(false);
        if ('error' in result) {
          setDraftError(result.error.message);
          return;
        }
        setSkill(result.skill);
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a reset after an unguarded rejectable await", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const Save = () => {
         const [saving, setSaving] = useState(false);
         const submit = async () => {
           setSaving(true);
           await api.post("/save");
           setSaving(false);
         };
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags when the catch rethrows unconditionally before the reset", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const Save = () => {
         const [saving, setSaving] = useState(false);
         const submit = async () => {
           setSaving(true);
           try {
             await api.post("/save");
           } catch (error) {
             throw error;
           }
           setSaving(false);
         };
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet in a `.test.` file (jest fixture components fail the test, not a user)", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const handleClick = async () => {
        setVisible(true);
        setLoading(true);
        await mockRequest(0);
        setLoading(false);
      };`,
      { filename: "src/components/picker/tests/picker.test.tsx" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet in a __tests__ directory (non-production test harness code)", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `it("heuristic 2", async () => {
        setFeedbackDisabledValue(true);
        expect(await userPassesFeedbackRequestHeuristic()).toBe(false);
        setFeedbackDisabledValue(false);
        expect(await userPassesFeedbackRequestHeuristic()).toBe(true);
      });`,
      { filename: "src/utils/__tests__/feedback.ts" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the catch clears the flag through a same-file reset helper (glific HSM shape)", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const HSM = () => {
        const resetUploadState = () => {
          setUploadingFile(false);
          setUploadedFile(null);
        };
        const handleFileUpload = async (file) => {
          setUploadedFile(file);
          setUploadingFile(true);
          try {
            const result = await uploadMedia({ variables: { media: file } });
            setAttachmentURL(result.data.uploadMedia);
            setUploadingFile(false);
          } catch (error) {
            setNotification('File upload failed. Please try again.', 'error');
            resetUploadState();
          }
        };
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags when the catch calls a same-file helper that does not reset the flag", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const Save = () => {
        const logFailure = (error) => {
          console.error(error);
        };
        const submit = async () => {
          setSaving(true);
          try {
            await persist(draft);
            setSaving(false);
          } catch (error) {
            logFailure(error);
          }
        };
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when the awaited `this.method` swallows every error in its own try/catch (cboard shape)", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `class InputImage extends React.Component {
        async resizeImage(file, imageName = null) {
          try {
            const { onChange } = this.props;
            const resizedBlob = await readAndCompressImage(file, configLQ);
            const blobHQ = await readAndCompressImage(file, configHQ);
            onChange(resizedBlob, imageName || file.name, blobHQ);
          } catch (err) {
            console.error(err);
          }
        }

        handleChange = async (event) => {
          const { setIsLoadingImage } = this.props;
          setIsLoadingImage(true);
          const file = event.target.files[0];
          if (file) {
            await this.resizeImage(file);
          }
          setIsLoadingImage(false);
        };
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not infer a React setter from a prop callback", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `class Uploader extends React.Component {
        async uploadFile(file) {
          await api.upload(file);
        }

        handleChange = async (event) => {
          const { setIsLoadingImage } = this.props;
          setIsLoadingImage(true);
          await this.uploadFile(event.target.files[0]);
          setIsLoadingImage(false);
        };
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags switch-case awaits even when the assigned result is checked afterwards", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const handleClick = async () => {
        setForceDisable(true);
        let response = { success: false };
        switch (true) {
          case customerEmail != null: {
            response = await saveAddresses({ customerEmail });
            break;
          }
          case order != null: {
            response = await saveAddresses({});
            break;
          }
        }
        setForceDisable(false);
        if (onClick && response.success) onClick(response);
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an assignment await whose result is never error-shape-checked", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const handleClick = async () => {
        setForceDisable(true);
        let response;
        response = await saveAddresses({ customerEmail });
        setForceDisable(false);
        onClick(response);
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet: same-file async helper awaiting only a delay and returning a sync array sort (docs demo fakeSort shape)", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `async function fakeSort(field, dir) {
        await new Promise(r => setTimeout(r, 250));
        return [...SOURCE].sort((a, b) => {
          if (a[field] < b[field]) return dir === 'asc' ? -1 : 1;
          if (a[field] > b[field]) return dir === 'asc' ? 1 : -1;
          return 0;
        });
      }
      const Demo = () => {
        const handleSort = useCallback(async (col, dir) => {
          setLoading(true);
          setLastSort({ field: col.sortField, dir });
          const sorted = await fakeSort(col.sortField, dir);
          setData(sorted);
          setLoading(false);
        }, []);
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a same-file async helper that returns a rejectable call", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `async function loadRows(field) {
        await new Promise(r => setTimeout(r, 250));
        return api.fetchRows(field);
      }
      const Demo = () => {
        const handleSort = async (col) => {
          setLoading(true);
          const rows = await loadRows(col.sortField);
          setData(rows);
          setLoading(false);
        };
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("no-loading-flag-reset-outside-finally cross-file helpers", () => {
  let temporaryDirectory = "";

  beforeEach(() => {
    // realpathSync: oxc-resolver returns real paths, and os.tmpdir() is a
    // symlink on macOS (/var -> /private/var).
    temporaryDirectory = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "rd-loading-flag-cross-file-")),
    );
    fs.writeFileSync(
      path.join(temporaryDirectory, "package.json"),
      JSON.stringify({ name: "fixture", type: "module" }),
    );
    __clearParseSourceFileCacheForTests();
  });

  afterEach(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  const writeFile = (relativePath: string, contents: string): string => {
    const absolutePath = path.join(temporaryDirectory, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, contents, "utf8");
    return absolutePath;
  };

  const GUARDED_UPLOAD_HELPER = `export const uploadFiles = async (files) => {
    const outcomes = [];
    for (const file of files) {
      try {
        await sendFile(file);
        outcomes.push(true);
      } catch (error) {
        outcomes.push(false);
      }
    }
    return outcomes;
  };`;

  const consumerCode = (importLine: string, awaitedName = "uploadFiles"): string =>
    `${importLine}
    const Modal = () => {
      const handleUpload = async () => {
        setUploading(true);
        const outcomes = await ${awaitedName}(items);
        setOutcomes(outcomes);
        setUploading(false);
      };
    };`;

  it("stays quiet when the awaited named import's foreign body catches every await", () => {
    writeFile("src/utils/file-upload.ts", GUARDED_UPLOAD_HELPER);
    const consumerFilename = writeFile(
      "src/Modal.tsx",
      consumerCode(`import { uploadFiles } from "./utils/file-upload";`),
    );
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      consumerCode(`import { uploadFiles } from "./utils/file-upload";`),
      { filename: consumerFilename },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags when the foreign body has an unguarded await", () => {
    writeFile(
      "src/utils/file-upload.ts",
      `export const uploadFiles = async (files) => {
        await sendAll(files);
      };`,
    );
    const consumerFilename = writeFile(
      "src/Modal.tsx",
      consumerCode(`import { uploadFiles } from "./utils/file-upload";`),
    );
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      consumerCode(`import { uploadFiles } from "./utils/file-upload";`),
      { filename: consumerFilename },
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags when the foreign body calls another opaque imported function (no transitive proof)", () => {
    writeFile(
      "src/utils/transport.ts",
      `export const sendAll = async (files) => {
        try {
          await post(files);
        } catch (error) {}
      };`,
    );
    writeFile(
      "src/utils/file-upload.ts",
      `import { sendAll } from "./transport";
      export const uploadFiles = async (files) => {
        await sendAll(files);
      };`,
    );
    const consumerFilename = writeFile(
      "src/Modal.tsx",
      consumerCode(`import { uploadFiles } from "./utils/file-upload";`),
    );
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      consumerCode(`import { uploadFiles } from "./utils/file-upload";`),
      { filename: consumerFilename },
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an import from a node_modules-style bare specifier", () => {
    const consumerFilename = writeFile(
      "src/Modal.tsx",
      consumerCode(`import { uploadFiles } from "upload-kit";`),
    );
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      consumerCode(`import { uploadFiles } from "upload-kit";`),
      { filename: consumerFilename },
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags when the rule runs without a filename (resolution no-ops)", () => {
    writeFile("src/utils/file-upload.ts", GUARDED_UPLOAD_HELPER);
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      consumerCode(`import { uploadFiles } from "./utils/file-upload";`),
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("resolves a renamed import (`import { uploadAll as upload }`)", () => {
    writeFile(
      "src/utils/file-upload.ts",
      `export const uploadAll = async (files) => {
        try {
          await sendAll(files);
        } catch (error) {}
      };`,
    );
    const consumerFilename = writeFile(
      "src/Modal.tsx",
      consumerCode(`import { uploadAll as upload } from "./utils/file-upload";`, "upload"),
    );
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      consumerCode(`import { uploadAll as upload } from "./utils/file-upload";`, "upload"),
      { filename: consumerFilename },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("resolves a guarded imported helper through a local const alias", () => {
    writeFile("src/utils/file-upload.ts", GUARDED_UPLOAD_HELPER);
    const source = consumerCode(
      `import { uploadFiles } from "./utils/file-upload";
      const upload = uploadFiles;`,
      "upload",
    );
    const consumerFilename = writeFile("src/Modal.tsx", source);
    const result = runRule(noLoadingFlagResetOutsideFinally, source, {
      filename: consumerFilename,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not trust a mutable alias of a guarded imported helper", () => {
    writeFile("src/utils/file-upload.ts", GUARDED_UPLOAD_HELPER);
    const source = consumerCode(
      `import { uploadFiles } from "./utils/file-upload";
      let upload = uploadFiles;
      upload = async () => fetch("/unsafe");`,
      "upload",
    );
    const consumerFilename = writeFile("src/Modal.tsx", source);
    const result = runRule(noLoadingFlagResetOutsideFinally, source, {
      filename: consumerFilename,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("resolves through a barrel re-export hop", () => {
    writeFile("src/utils/file-upload.ts", GUARDED_UPLOAD_HELPER);
    writeFile("src/utils/index.ts", `export { uploadFiles } from "./file-upload";`);
    const consumerFilename = writeFile(
      "src/Modal.tsx",
      consumerCode(`import { uploadFiles } from "./utils";`),
    );
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      consumerCode(`import { uploadFiles } from "./utils";`),
      { filename: consumerFilename },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a non-async resolve-only helper imported through a directory barrel", () => {
    writeFile(
      "src/util/helpers.ts",
      `export const timeout = (milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds));`,
    );
    writeFile("src/util/index.ts", `export { timeout } from "./helpers";`);
    const source = `import { timeout } from "./util";
      const Demo = () => {
        const process = async () => {
          setProcessing(true);
          await timeout(2_000);
          setProcessing(false);
        };
      };`;
    const consumerFilename = writeFile("src/Demo.tsx", source);
    const result = runRule(noLoadingFlagResetOutsideFinally, source, {
      filename: consumerFilename,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["throws synchronously", `export const wait = () => { throw new Error("failed"); };`],
    ["calls an unknown function", `export const wait = () => request();`],
    [
      "calls an unknown function before returning",
      `export const wait = () => { recordAttempt(); return Promise.resolve(); };`,
    ],
    ["returns a rejected promise", `export const wait = () => Promise.reject(new Error());`],
  ])("still flags when a non-async imported helper %s", (_description, helperSource) => {
    writeFile("src/wait.ts", helperSource);
    const source = `import { wait } from "./wait";
      const Demo = () => {
        const process = async () => {
          setProcessing(true);
          await wait();
          setProcessing(false);
        };
      };`;
    const consumerFilename = writeFile("src/Demo.tsx", source);
    const result = runRule(noLoadingFlagResetOutsideFinally, source, {
      filename: consumerFilename,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("resolves a foreign const initializer wrapping useCallback", () => {
    writeFile(
      "src/utils/file-upload.ts",
      `import { useCallback } from "react";
      export const uploadFiles = useCallback(async (files) => {
        try {
          await sendAll(files);
        } catch (error) {}
      }, []);`,
    );
    const consumerFilename = writeFile(
      "src/Modal.tsx",
      consumerCode(`import { uploadFiles } from "./utils/file-upload";`),
    );
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      consumerCode(`import { uploadFiles } from "./utils/file-upload";`),
      { filename: consumerFilename },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  const hookConsumerCode = `import { useMediaAnnotations } from "./use-media-annotations";
    const Editor = () => {
      const { annotate } = useMediaAnnotations();
      const save = async () => {
        setSaving(true);
        await annotate(payload);
        setSaving(false);
      };
    };`;

  it("stays quiet for a guarded function destructured from an imported hook's returned object", () => {
    writeFile(
      "src/use-media-annotations.ts",
      `export const useMediaAnnotations = () => {
        const annotate = async (input) => {
          try {
            await persist(input);
          } catch (error) {}
        };
        return { annotate };
      };`,
    );
    const consumerFilename = writeFile("src/Editor.tsx", hookConsumerCode);
    const result = runRule(noLoadingFlagResetOutsideFinally, hookConsumerCode, {
      filename: consumerFilename,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags when the imported hook's returned function has an unguarded await", () => {
    writeFile(
      "src/use-media-annotations.ts",
      `export const useMediaAnnotations = () => {
        const annotate = async (input) => {
          await persist(input);
        };
        return { annotate };
      };`,
    );
    const consumerFilename = writeFile("src/Editor.tsx", hookConsumerCode);
    const result = runRule(noLoadingFlagResetOutsideFinally, hookConsumerCode, {
      filename: consumerFilename,
    });
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a COMPUTED destructure off the imported hook (key is not statically known)", () => {
    writeFile(
      "src/use-media-annotations.ts",
      `export const useMediaAnnotations = () => {
        const safeKey = async (input) => {
          try {
            await persist(input);
          } catch (error) {}
        };
        const risky = async (input) => {
          await persist(input);
        };
        return { safeKey, risky };
      };`,
    );
    const computedConsumerCode = `import { useState } from "react";
      import { useMediaAnnotations } from "./use-media-annotations";
      export const Editor = () => {
        const [saving, setSaving] = useState(false);
        const safeKey = "risky";
        const { [safeKey]: doIt } = useMediaAnnotations();
        const save = async () => {
          setSaving(true);
          await doIt({});
          setSaving(false);
        };
        return save;
      };`;
    const consumerFilename = writeFile("src/Editor.tsx", computedConsumerCode);
    const result = runRule(noLoadingFlagResetOutsideFinally, computedConsumerCode, {
      filename: consumerFilename,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet for a guarded useCallback function returned through the hook's useMemo object", () => {
    writeFile(
      "src/use-workspace-data.ts",
      `import { useCallback, useMemo } from "react";
      export const useWorkspaceData = () => {
        const loadRecentViews = useCallback(async () => {
          try {
            await service.getRecentViews();
          } catch (error) {}
        }, []);
        return useMemo(() => ({ loadRecentViews }), [loadRecentViews]);
      };`,
    );
    const consumer = `import { useWorkspaceData } from "./use-workspace-data";
    const Search = () => {
      const { loadRecentViews } = useWorkspaceData();
      const open = async () => {
        setLoadingRecentViews(true);
        await loadRecentViews();
        setLoadingRecentViews(false);
      };
    };`;
    const consumerFilename = writeFile("src/Search.tsx", consumer);
    const result = runRule(noLoadingFlagResetOutsideFinally, consumer, {
      filename: consumerFilename,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not trust a reassigned imported helper", () => {
    writeFile(
      "src/wait.ts",
      `export let wait = async () => { try { await safe(); } catch {} };
      wait = async () => risky();`,
    );
    const consumer = `import { wait } from "./wait";
      const run = async () => {
        setLoading(true);
        await wait();
        setLoading(false);
      };`;
    const consumerFilename = writeFile("src/consumer.tsx", consumer);
    const result = runRule(noLoadingFlagResetOutsideFinally, consumer, {
      filename: consumerFilename,
    });
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trust reassigned exported declarations or useCallback bindings", () => {
    writeFile(
      "src/function-helper.ts",
      `export async function wait() { try { await safe(); } catch {} }
      wait = async () => risky();`,
    );
    writeFile(
      "src/callback-helper.ts",
      `import { useCallback } from "react";
      export let wait = useCallback(async () => { try { await safe(); } catch {} }, []);
      wait = async () => risky();`,
    );
    const functionConsumer = `import { wait } from "./function-helper";
      const run = async () => { setLoading(true); await wait(); setLoading(false); };`;
    const callbackConsumer = `import { wait } from "./callback-helper";
      const run = async () => { setLoading(true); await wait(); setLoading(false); };`;
    const functionFilename = writeFile("src/function-consumer.tsx", functionConsumer);
    const callbackFilename = writeFile("src/callback-consumer.tsx", callbackConsumer);
    const functionResult = runRule(noLoadingFlagResetOutsideFinally, functionConsumer, {
      filename: functionFilename,
    });
    const callbackResult = runRule(noLoadingFlagResetOutsideFinally, callbackConsumer, {
      filename: callbackFilename,
    });
    expect(functionResult.diagnostics).toHaveLength(1);
    expect(callbackResult.diagnostics).toHaveLength(1);
  });

  it("does not trust a mutable function returned by an imported hook", () => {
    writeFile(
      "src/use-media-annotations.ts",
      `export const useMediaAnnotations = () => {
        const safe = async () => { try { await persist(); } catch {} };
        let annotate = safe;
        annotate = async () => persist();
        return { annotate };
      };`,
    );
    const consumerFilename = writeFile("src/Editor.tsx", hookConsumerCode);
    const result = runRule(noLoadingFlagResetOutsideFinally, hookConsumerCode, {
      filename: consumerFilename,
    });
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trust a mutable imported-hook consumer binding", () => {
    writeFile(
      "src/use-safe-action.ts",
      `export const useSafeAction = () => {
        const save = async () => { try { await persist(); } catch {} };
        return { save };
      };`,
    );
    const consumer = `import { useSafeAction } from "./use-safe-action";
      const run = async () => {
        let { save } = useSafeAction();
        save = risky;
        setLoading(true);
        await save();
        setLoading(false);
      };`;
    const consumerFilename = writeFile("src/mutable-consumer.tsx", consumer);
    const result = runRule(noLoadingFlagResetOutsideFinally, consumer, {
      filename: consumerFilename,
    });
    expect(result.diagnostics).toHaveLength(1);
  });

  it("requires foreign useCallback and useMemo wrappers to come from React", () => {
    writeFile(
      "src/shadowed-callback.ts",
      `const useCallback = (callback) => risky(callback);
      export const save = useCallback(async () => { try { await persist(); } catch {} });`,
    );
    writeFile(
      "src/shadowed-memo.ts",
      `const useMemo = (factory) => risky(factory);
      export const useSafeAction = () => {
        const save = async () => { try { await persist(); } catch {} };
        return useMemo(() => ({ save }));
      };`,
    );
    const callbackConsumer = `import { save } from "./shadowed-callback";
      const run = async () => { setLoading(true); await save(); setLoading(false); };`;
    const memoConsumer = `import { useSafeAction } from "./shadowed-memo";
      const run = async () => {
        const { save } = useSafeAction();
        setLoading(true);
        await save();
        setLoading(false);
      };`;
    const callbackFilename = writeFile("src/shadowed-callback-consumer.tsx", callbackConsumer);
    const memoFilename = writeFile("src/shadowed-memo-consumer.tsx", memoConsumer);
    expect(
      runRule(noLoadingFlagResetOutsideFinally, callbackConsumer, {
        filename: callbackFilename,
      }).diagnostics,
    ).toHaveLength(1);
    expect(
      runRule(noLoadingFlagResetOutsideFinally, memoConsumer, {
        filename: memoFilename,
      }).diagnostics,
    ).toHaveLength(1);
  });

  it("does not let a shadowed Promise make a foreign helper rejection-proof", () => {
    writeFile(
      "src/wait.ts",
      `const Promise = { resolve: () => risky() };
      export const wait = async () => Promise.resolve();`,
    );
    const consumer = `import { wait } from "./wait";
      const run = async () => {
        setLoading(true);
        await wait();
        setLoading(false);
      };`;
    const consumerFilename = writeFile("src/consumer.tsx", consumer);
    const result = runRule(noLoadingFlagResetOutsideFinally, consumer, {
      filename: consumerFilename,
    });
    expect(result.diagnostics).toHaveLength(1);
  });

  it("budgets cross-file parsing by module rather than exported name", () => {
    writeFile(
      "src/waits.ts",
      `export const waitOne = async () => { try { await first(); } catch {} };
      export const waitTwo = async () => { try { await second(); } catch {} };
      export const waitThree = async () => { try { await third(); } catch {} };
      export const waitFour = async () => { try { await fourth(); } catch {} };`,
    );
    const consumer = `import { waitOne, waitTwo, waitThree, waitFour } from "./waits";
      const run = async () => {
        setLoading(true);
        await waitOne();
        await waitTwo();
        await waitThree();
        await waitFour();
        setLoading(false);
      };`;
    const consumerFilename = writeFile("src/consumer.tsx", consumer);
    const result = runRule(noLoadingFlagResetOutsideFinally, consumer, {
      filename: consumerFilename,
    });
    expect(result.diagnostics).toHaveLength(0);
  });
});

describe("no-loading-flag-reset-outside-finally audit regressions", () => {
  it("does not let an earlier or conditional catch reset protect a later rejection", () => {
    const earlierCatch = runRule(
      noLoadingFlagResetOutsideFinally,
      `const run = async () => { setLoading(true); try { await first(); } catch { setLoading(false); } await second(); setLoading(false); };`,
    );
    const conditionalCatch = runRule(
      noLoadingFlagResetOutsideFinally,
      `const run = async () => { setLoading(true); try { await save(); } catch { if (shouldReset) setLoading(false); } };`,
    );
    expect(earlierCatch.diagnostics).toHaveLength(1);
    expect(conditionalCatch.diagnostics).toHaveLength(1);
  });

  it("flags an empty catch chain and keeps exclusive paths separate", () => {
    const emptyCatch = runRule(
      noLoadingFlagResetOutsideFinally,
      `const run = async () => { setLoading(true); await fetch("/x").catch(); setLoading(false); };`,
    );
    const exclusive = runRule(
      noLoadingFlagResetOutsideFinally,
      `const run = async () => { if (mode === "load") { setLoading(true); await load(); } else { setLoading(false); } };`,
    );
    expect(emptyCatch.diagnostics).toHaveLength(1);
    expect(exclusive.diagnostics).toHaveLength(0);
  });

  it("does not treat a local loading-named function as React state", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const setLoading = (value) => log(value); const run = async () => { setLoading(true); await load(); setLoading(false); };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("indexes a large straight-line function without combinatorial scanning", () => {
    const sites = Array.from(
      { length: STRESS_SITE_COUNT },
      (_, siteIndex) => `setLoading(true); await load(${siteIndex}); setLoading(false);`,
    ).join("\n");
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const run = async () => { ${sites} };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat Promise.resolve as rejection absorption for a rejecting argument", () => {
    const rejectingArgument = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useState } from "react";
      const Component = () => {
        const [, setLoading] = useState(false);
        const run = async () => {
          setLoading(true);
          await Promise.resolve(fetch("/data"));
          setLoading(false);
        };
      };`,
    );
    const fulfilledValue = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useState } from "react";
      const Component = () => {
        const [, setLoading] = useState(false);
        const run = async () => {
          setLoading(true);
          await Promise.resolve(null);
          setLoading(false);
        };
      };`,
    );
    expect(rejectingArgument.diagnostics).toHaveLength(1);
    expect(fulfilledValue.diagnostics).toHaveLength(0);
  });

  it("requires a catch handler to return a definitely fulfilled value", () => {
    const rejectingFallback = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useState } from "react";
      const Component = () => {
        const [, setLoading] = useState(false);
        const run = async () => {
          setLoading(true);
          await fetch("/data").catch(() => fetch("/fallback"));
          setLoading(false);
        };
      };`,
    );
    const fulfilledFallback = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useState } from "react";
      const Component = () => {
        const [, setLoading] = useState(false);
        const run = async () => {
          setLoading(true);
          await fetch("/data").catch(() => null);
          setLoading(false);
        };
      };`,
    );
    expect(rejectingFallback.diagnostics).toHaveLength(1);
    expect(fulfilledFallback.diagnostics).toHaveLength(0);
  });

  it("recognizes fulfilled catch promises and rejecting Promise executor adoption", () => {
    const fulfilledCatchPromise = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useState } from "react";
      const Component = () => {
        const [, setLoading] = useState(false);
        const run = async () => {
          setLoading(true);
          await fetch("/data").catch(() => Promise.resolve(null));
          setLoading(false);
        };
      };`,
    );
    const rejectingExecutorAdoption = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useState } from "react";
      const Component = () => {
        const [, setLoading] = useState(false);
        const run = async () => {
          setLoading(true);
          await new Promise((resolve) => queueMicrotask(() => resolve(fetch("/data"))));
          setLoading(false);
        };
      };`,
    );
    expect(fulfilledCatchPromise.diagnostics).toHaveLength(0);
    expect(rejectingExecutorAdoption.diagnostics).toHaveLength(1);
  });

  it("ignores throws deferred into a nested callback inside an absorbing catch", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useState } from "react";
      const load = async () => {
        try {
          return await fetch("/data");
        } catch {
          queueMicrotask(() => { throw new Error("deferred"); });
          return null;
        }
      };
      const Component = () => {
        const [, setLoading] = useState(false);
        const run = async () => {
          setLoading(true);
          await load();
          setLoading(false);
        };
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not let an early return or conditional helper make a catch reset unconditional", () => {
    const earlyReturn = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useState } from "react";
      const Component = () => {
        const [, setLoading] = useState(false);
        const run = async () => {
          setLoading(true);
          try { await fetch("/data"); }
          catch { if (ignore) return; setLoading(false); }
          setLoading(false);
        };
      };`,
    );
    const conditionalHelper = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useState } from "react";
      const Component = () => {
        const [, setLoading] = useState(false);
        const clear = () => { if (shouldClear) setLoading(false); };
        const run = async () => {
          setLoading(true);
          try { await fetch("/data"); }
          catch { clear(); }
          setLoading(false);
        };
      };`,
    );
    expect(earlyReturn.diagnostics).toHaveLength(1);
    expect(conditionalHelper.diagnostics).toHaveLength(1);
  });

  it("distinguishes switch fallthrough and conditional-expression branches", () => {
    const fallthrough = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useState } from "react";
      const Component = () => {
        const [, setLoading] = useState(false);
        const run = async () => {
          switch (mode) {
            case "start": setLoading(true);
            case "load": await fetch("/data"); break;
          }
          setLoading(false);
        };
      };`,
    );
    const exclusiveTernary = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useState } from "react";
      const Component = () => {
        const [, setLoading] = useState(false);
        const run = async () => {
          mode === "start" ? setLoading(true) : await fetch("/data");
          setLoading(false);
        };
      };`,
    );
    expect(fallthrough.diagnostics).toHaveLength(1);
    expect(exclusiveTernary.diagnostics).toHaveLength(0);
  });

  it("recognizes constant functional loading-flag updaters", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useState } from "react";
      const Component = () => {
        const [, setLoading] = useState(false);
        const run = async () => {
          setLoading(() => true);
          await fetch("/data");
          setLoading(() => false);
        };
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("indexes exceptional protection once for many awaits and resets", () => {
    const awaits = Array.from(
      { length: STRESS_SITE_COUNT },
      (_, siteIndex) => `await load(${siteIndex});`,
    ).join("\n");
    const resets = Array.from({ length: STRESS_SITE_COUNT }, () => "setLoading(false);").join("\n");
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useState } from "react";
      const Component = () => {
        const [, setLoading] = useState(false);
        const run = async () => {
          setLoading(true);
          try { ${awaits} ${resets} }
          finally { setLoading(false); }
        };
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not trust shadowed Promise constructors or methods as fulfillment proof", () => {
    const shadowedResolve = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useState } from "react"; const Promise = { resolve: fetch }; const C = () => { const [, setLoading] = useState(false); const run = async () => { setLoading(true); await Promise.resolve("/value"); setLoading(false); }; };`,
    );
    const shadowedConstructor = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useState } from "react"; const Promise = class { constructor() { return fetch("/value"); } }; const C = () => { const [, setLoading] = useState(false); const run = async () => { setLoading(true); await new Promise((resolve) => resolve(null)); setLoading(false); }; };`,
    );
    expect(shadowedResolve.diagnostics).toHaveLength(1);
    expect(shadowedConstructor.diagnostics).toHaveLength(1);
  });

  it("recognizes rejection from Promise executors, async helpers, and invalid allSettled inputs", () => {
    const executorCall = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useState } from "react"; const fail = () => { throw new Error("failed"); }; const C = () => { const [, setLoading] = useState(false); const run = async () => { setLoading(true); await new Promise((resolve) => { fail(); resolve(null); }); setLoading(false); }; };`,
    );
    const asyncHelperCall = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useState } from "react"; const fail = () => { throw new Error("failed"); }; const request = async () => { fail(); return null; }; const C = () => { const [, setLoading] = useState(false); const run = async () => { setLoading(true); await request(); setLoading(false); }; };`,
    );
    const invalidAllSettledInput = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useState } from "react"; const C = () => { const [, setLoading] = useState(false); const run = async () => { setLoading(true); await Promise.allSettled(null); setLoading(false); }; };`,
    );
    const iterableAllSettledInput = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useState } from "react"; const C = () => { const [, setLoading] = useState(false); const run = async () => { setLoading(true); await Promise.allSettled({ *[Symbol.iterator]() { yield 1; } }); setLoading(false); }; };`,
    );
    expect(executorCall.diagnostics).toHaveLength(1);
    expect(asyncHelperCall.diagnostics).toHaveLength(1);
    expect(invalidAllSettledInput.diagnostics).toHaveLength(1);
    expect(iterableAllSettledInput.diagnostics).toHaveLength(0);
  });

  it("flags Promise.allSettled when producing the iterable can throw synchronously", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useState } from "react";
      const Component = () => {
        const [, setLoading] = useState(false);
        const run = async () => {
          setLoading(true);
          await Promise.allSettled(getTasks());
          setLoading(false);
        };
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["opaque call", "getTask()"],
    ["member read", "taskSource.current"],
    ["iterable spread", "...tasks"],
  ])("flags Promise.allSettled when an array element %s can throw", (_shape, element) => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const run = async () => {
        setLoading(true);
        await Promise.allSettled([${element}]);
        setLoading(false);
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags Promise.allSettled when an unresolved iterable binding can hide a throwing iterator", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const run = async () => {
        setLoading(true);
        await Promise.allSettled(tasks);
        setLoading(false);
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags Promise.allSettled when its custom iterator throws", () => {
    const throwingIterator = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useState } from "react";
      const Component = () => {
        const [, setLoading] = useState(false);
        const run = async () => {
          setLoading(true);
          await Promise.allSettled({
            [Symbol.iterator]() {
              throw new Error("iterator failed");
            },
          });
          setLoading(false);
        };
      };`,
    );
    const opaqueIterator = runRule(
      noLoadingFlagResetOutsideFinally,
      `const run = async () => {
        setLoading(true);
        await Promise.allSettled({
          *[Symbol.iterator]() {
            prepareIteration();
            yield 1;
          },
        });
        setLoading(false);
      };`,
    );
    const getterIterator = runRule(
      noLoadingFlagResetOutsideFinally,
      `const source = { get value() { throw new Error("getter failed"); } };
      const run = async () => {
        setLoading(true);
        await Promise.allSettled({
          *[Symbol.iterator]() {
            yield source.value;
          },
        });
        setLoading(false);
      };`,
    );
    expect(throwingIterator.parseErrors).toEqual([]);
    expect(throwingIterator.diagnostics).toHaveLength(1);
    expect(opaqueIterator.diagnostics).toHaveLength(1);
    expect(getterIterator.diagnostics).toHaveLength(1);
  });

  it("keeps Promise.allSettled safe for precomputed iterables and non-throwing custom iterators", () => {
    const precomputedIterable = runRule(
      noLoadingFlagResetOutsideFinally,
      `const run = async () => {
        const tasks = [];
        setLoading(true);
        await Promise.allSettled(tasks);
        setLoading(false);
      };`,
    );
    const customIterable = runRule(
      noLoadingFlagResetOutsideFinally,
      `const run = async () => {
        setLoading(true);
        await Promise.allSettled({
          *[Symbol.iterator]() {
            yield 1;
          },
        });
        setLoading(false);
      };`,
    );
    expect(precomputedIterable.diagnostics).toHaveLength(0);
    expect(customIterable.diagnostics).toHaveLength(0);
  });

  it("keeps Promise.allSettled safe for an exact non-throwing local array factory", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const getTasks = () => [];
      const run = async () => {
        setLoading(true);
        await Promise.allSettled(getTasks());
        setLoading(false);
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps Promise.allSettled safe for literal array elements and stable references", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const stableTask = 1;
      const run = async () => {
        setLoading(true);
        await Promise.allSettled([, null, "ready", 42, stableTask]);
        setLoading(false);
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("rejects a local array factory whose elements require opaque evaluation", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const getTasks = () => [getTask()];
      const run = async () => {
        setLoading(true);
        await Promise.allSettled(getTasks());
        setLoading(false);
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("recognizes an unconditional call to a known-throwing catch helper", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useState } from "react"; const rethrow = () => { throw new Error("failed"); }; const C = () => { const [, setLoading] = useState(false); const run = async () => { setLoading(true); try { await fetch("/value"); } catch { rethrow(); } setLoading(false); }; };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts catch exits only when every exiting path clears the flag first", () => {
    const allPathsClear = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useState } from "react"; const C = () => { const [, setLoading] = useState(false); const run = async () => { setLoading(true); try { await fetch("/value"); } catch (error) { if (shouldRetry) { setLoading(false); return; } setLoading(false); throw error; } setLoading(false); }; };`,
    );
    const onePathSkipsClear = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useState } from "react"; const C = () => { const [, setLoading] = useState(false); const run = async () => { setLoading(true); try { await fetch("/value"); } catch (error) { if (shouldRetry) return; setLoading(false); throw error; } setLoading(false); }; };`,
    );
    expect(allPathsClear.diagnostics).toHaveLength(0);
    expect(onePathSkipsClear.diagnostics).toHaveLength(1);
  });

  it("distinguishes throwing calls before and after a catch reset", () => {
    const throwBeforeClear = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useState } from "react"; const fail = () => { throw new Error("failed"); }; const C = () => { const [, setLoading] = useState(false); const run = async () => { setLoading(true); try { await fetch("/value"); } catch { fail(); setLoading(false); } setLoading(false); }; };`,
    );
    const throwAfterClear = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useState } from "react"; const fail = () => { throw new Error("failed"); }; const C = () => { const [, setLoading] = useState(false); const run = async () => { setLoading(true); try { await fetch("/value"); } catch { setLoading(false); fail(); } setLoading(false); }; };`,
    );
    expect(throwBeforeClear.diagnostics).toHaveLength(1);
    expect(throwAfterClear.diagnostics).toHaveLength(0);
  });

  it("tracks throwing catch conditions and initializers before the reset", () => {
    const throwingCondition = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useState } from "react"; const fail = () => { throw new Error("failed"); }; const C = () => { const [, setLoading] = useState(false); const run = async () => { setLoading(true); try { await fetch("/value"); } catch { if (fail()) return; setLoading(false); } setLoading(false); }; };`,
    );
    const throwingInitializer = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useState } from "react"; const fail = () => { throw new Error("failed"); }; const C = () => { const [, setLoading] = useState(false); const run = async () => { setLoading(true); try { await fetch("/value"); } catch { const reason = fail(); setLoading(false); } setLoading(false); }; };`,
    );
    const clearingReturnArgument = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useState } from "react"; const C = () => { const [, setLoading] = useState(false); const run = async () => { setLoading(true); try { await fetch("/value"); } catch { return setLoading(false); } setLoading(false); }; };`,
    );
    expect(throwingCondition.diagnostics).toHaveLength(1);
    expect(throwingInitializer.diagnostics).toHaveLength(1);
    expect(clearingReturnArgument.diagnostics).toHaveLength(0);
  });

  it("keeps catch-path analysis bounded across many conditional branches", () => {
    const conditionalStatements = Array.from(
      { length: STRESS_SITE_COUNT },
      (_, conditionIndex) => `if (conditions[${conditionIndex}]) status = ${conditionIndex};`,
    ).join("\n");
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useState } from "react";
      const C = () => {
        const [, setLoading] = useState(false);
        const run = async () => {
          setLoading(true);
          try { await fetch("/value"); }
          catch { ${conditionalStatements} }
          setLoading(false);
        };
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("groups stable setter aliases by binding identity", () => {
    const aliasedReset = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useState } from "react";
      const C = () => {
        const [, setLoading] = useState(false);
        const clear = setLoading;
        const run = async () => {
          setLoading(true);
          await load();
          clear(false);
        };
      };`,
    );
    const aliasedStart = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useState } from "react";
      const C = () => {
        const [, setLoading] = useState(false);
        const start = setLoading;
        const run = async () => {
          start(true);
          await load();
          setLoading(false);
        };
      };`,
    );
    expect(aliasedReset.diagnostics).toHaveLength(1);
    expect(aliasedStart.diagnostics).toHaveLength(1);
  });

  it("does not let a helper clearing another setter binding protect the hook setter", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const clear = () => setLoading(false);
      const C = () => {
        const [, setLoading] = useState(false);
        const run = async () => {
          setLoading(true);
          try { await load(); } catch { clear(); return; }
          setLoading(false);
        };
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trust sync helpers or unguarded sync calls inside async helpers", () => {
    const syncHelper = runRule(
      noLoadingFlagResetOutsideFinally,
      `const wait = () => { mayThrow(); return Promise.resolve(); };
      const run = async () => {
        setLoading(true);
        await wait();
        setLoading(false);
      };`,
    );
    const asyncHelper = runRule(
      noLoadingFlagResetOutsideFinally,
      `const wait = async () => {
        try { await fetch("/safe"); } catch {}
        mayThrow();
      };
      const run = async () => {
        setLoading(true);
        await wait();
        setLoading(false);
      };`,
    );
    expect(syncHelper.diagnostics).toHaveLength(1);
    expect(asyncHelper.diagnostics).toHaveLength(1);
  });

  it("tracks aliases and indexed writes to Promise.all arrays", () => {
    const aliasPush = runRule(
      noLoadingFlagResetOutsideFinally,
      `const run = async () => {
        setLoading(true);
        const requests = [];
        const pending = requests;
        pending.push(fetch("/bad"));
        await Promise.all(requests);
        setLoading(false);
      };`,
    );
    const indexedWrite = runRule(
      noLoadingFlagResetOutsideFinally,
      `const run = async () => {
        setLoading(true);
        const requests = [];
        requests[0] = fetch("/bad");
        await Promise.all(requests);
        setLoading(false);
      };`,
    );
    expect(aliasPush.diagnostics).toHaveLength(1);
    expect(indexedWrite.diagnostics).toHaveLength(1);
  });

  it("ignores deferred and shadowed Promise array mutations", () => {
    const deferredMutation = runRule(
      noLoadingFlagResetOutsideFinally,
      `const run = async () => {
        setLoading(true);
        const requests = [];
        const mutateLater = () => requests.push(fetch("/bad"));
        await Promise.all(requests);
        setLoading(false);
      };`,
    );
    const shadowedMutation = runRule(
      noLoadingFlagResetOutsideFinally,
      `const run = async () => {
        setLoading(true);
        const requests = [];
        const mutateLater = () => {
          const requests = [];
          requests.push(fetch("/bad"));
        };
        await Promise.all(requests);
        setLoading(false);
      };`,
    );
    const mutationAfterAwait = runRule(
      noLoadingFlagResetOutsideFinally,
      `const run = async () => {
        setLoading(true);
        const requests = [];
        await Promise.all(requests);
        requests.push(fetch("/later"));
        setLoading(false);
      };`,
    );
    expect(deferredMutation.diagnostics).toHaveLength(0);
    expect(shadowedMutation.diagnostics).toHaveLength(0);
    expect(mutationAfterAwait.diagnostics).toHaveLength(0);
  });

  it("proves stable class helpers and rejects mutable class helpers", () => {
    const stable = runRule(
      noLoadingFlagResetOutsideFinally,
      `class Loader {
        async safe() { try { await fetch("/value"); } catch {} }
        async run() { setLoading(true); await this.safe(); setLoading(false); }
      }`,
    );
    const mutable = runRule(
      noLoadingFlagResetOutsideFinally,
      `class Loader {
        async safe() { try { await fetch("/value"); } catch {} }
        replace() { this.safe = risky; }
        async run() { setLoading(true); await this.safe(); setLoading(false); }
      }`,
    );
    expect(stable.diagnostics).toHaveLength(0);
    expect(mutable.diagnostics).toHaveLength(1);
  });

  it("accepts definitely non-thenable Promise.all values, holes, bindings, and indexed writes", () => {
    const literalValues = runRule(
      noLoadingFlagResetOutsideFinally,
      `const run = async () => {
        setLoading(true);
        const value = 1;
        await Promise.all([, null, "ready", value]);
        setLoading(false);
      };`,
    );
    const indexedValues = runRule(
      noLoadingFlagResetOutsideFinally,
      `const run = async () => {
        setLoading(true);
        const value = 1;
        const requests = [];
        requests[0] = value;
        await Promise.all(requests);
        setLoading(false);
      };`,
    );
    expect(literalValues.diagnostics).toHaveLength(0);
    expect(indexedValues.diagnostics).toHaveLength(0);
  });

  it.each(["42", "null", `"ready"`, "`ready`", "[]", "({})"])(
    "accepts a direct await of the definitely non-thenable value %s",
    (awaitedValue) => {
      const result = runRule(
        noLoadingFlagResetOutsideFinally,
        `const run = async () => {
          setLoading(true);
          await ${awaitedValue};
          setLoading(false);
        };`,
      );
      expect(result.diagnostics).toHaveLength(0);
    },
  );

  it.each([
    ["constructor", `new Risky();`],
    ["known getter", `const value = source.result;`],
    ["mutated array push", `requests.push = risky; requests.push(Promise.resolve());`],
    ["opaque array callback", `[].forEach(() => risky());`],
  ])("rejects a helper containing a synchronous %s", (_shape, statement) => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const source = { get result() { throw new Error("failed"); } };
      const safe = async () => {
        const requests = [];
        ${statement}
        try { await fetch("/value"); } catch {}
      };
      const run = async () => { setLoading(true); await safe(); setLoading(false); };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows a proven React state setter inside a guarded helper", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `import { useState } from "react";
      const Component = () => {
        const [, setValue] = useState(null);
        const safe = async () => {
          setValue("ready");
          try { await fetch("/value"); } catch {}
        };
        const run = async () => { setLoading(true); await safe(); setLoading(false); };
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not accept .catch on an arbitrary non-promise object", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const cache = { catch: () => null };
      const run = async () => {
        setLoading(true);
        await cache.catch(() => null);
        setLoading(false);
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a synchronously throwing catch handler as rejection-absorbing", () => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const fail = () => { throw new Error("failed"); };
      const run = async () => {
        setLoading(true);
        await fetch("/value").catch(() => { fail(); return null; });
        setLoading(false);
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["catch", `fetch("/value").catch(() => { mayThrow(); return null; })`],
    [
      "then rejection handler",
      `fetch("/value").then(undefined, () => { mayThrow(); return null; })`,
    ],
  ])("does not trust an opaque call in a %s", (_shape, awaitedExpression) => {
    const result = runRule(
      noLoadingFlagResetOutsideFinally,
      `const run = async () => {
        setLoading(true);
        await ${awaitedExpression};
        setLoading(false);
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("distinguishes opaque calls before and after catch and finally resets", () => {
    const catchBefore = runRule(
      noLoadingFlagResetOutsideFinally,
      `const run = async () => { setLoading(true); try { await load(); } catch { risky(); setLoading(false); } };`,
    );
    const catchAfter = runRule(
      noLoadingFlagResetOutsideFinally,
      `const run = async () => { setLoading(true); try { await load(); } catch { setLoading(false); risky(); } };`,
    );
    const finallyBefore = runRule(
      noLoadingFlagResetOutsideFinally,
      `const run = async () => { setLoading(true); try { await load(); } finally { risky(); setLoading(false); } };`,
    );
    const finallyAfter = runRule(
      noLoadingFlagResetOutsideFinally,
      `const run = async () => { setLoading(true); try { await load(); } finally { setLoading(false); risky(); } };`,
    );
    expect(catchBefore.diagnostics).toHaveLength(1);
    expect(catchAfter.diagnostics).toHaveLength(0);
    expect(finallyBefore.diagnostics).toHaveLength(1);
    expect(finallyAfter.diagnostics).toHaveLength(0);
  });
});
