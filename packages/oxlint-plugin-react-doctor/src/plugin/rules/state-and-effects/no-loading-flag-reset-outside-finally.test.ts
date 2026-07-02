import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noLoadingFlagResetOutsideFinally } from "./no-loading-flag-reset-outside-finally.js";

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

  it("stays quiet for a never-rejecting result-object wrapper whose result is branch-checked", () => {
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
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the awaited result binding itself is truthiness-checked (if (!result) guard)", () => {
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
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for the destructured error-field convention (supabase-style { data, error })", () => {
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
    expect(result.diagnostics).toHaveLength(0);
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

  it("stays quiet when the awaited Promise.all result is result-shape-checked inside an array-method callback", () => {
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
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when a single awaited result is result-shape-checked via .some on the binding", () => {
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
    expect(result.diagnostics).toHaveLength(0);
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
});
