import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAsyncEventHandlerWithoutReentryGuard } from "./no-async-event-handler-without-reentry-guard.js";

describe("no-async-event-handler-without-reentry-guard", () => {
  it("flags an onSubmit handler that POSTs then sets state with no guard", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function Signup() {
        async function handleSubmit(event) {
          event.preventDefault();
          const res = await fetch('/api/signup', { method: 'POST', body });
          setSubmitted(true);
        }
        return <form onSubmit={handleSubmit} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an onClick arrow that awaits api.post then sets state", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function List({ id, email }) {
        const onSubscribe = async () => {
          await api.post(\`/lists/\${id}/subscribe\`, { email });
          setJoined(true);
        };
        return <button onClick={onSubscribe}>Subscribe</button>;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an inline async onSubmit with a PATCH before any state flip", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `const Form = () => (
        <form onSubmit={async () => {
          await fetch('/api/reset', { method: 'PATCH', body });
          setDone(true);
        }} />
      );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag an idempotent clipboard copy", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function Terminal({ text }) {
        const handleCopy = async () => {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        };
        return <button onClick={handleCopy} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the leading setLoading(true) loading-flag pattern", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function PasswordForm() {
        async function onSubmit() {
          setLoading(true);
          try {
            await fetch('/api/password', { method: 'PUT', body });
          } finally {
            setLoading(false);
          }
        }
        return <button disabled={loading} onClick={onSubmit}>Save</button>;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a leading if (busy) return guard", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function Modal() {
        async function submit() {
          if (sending) return;
          setSending(true);
          await fetch('/api/x', { method: 'POST' });
          setDone(true);
        }
        return <button onClick={submit} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a non-mutating GET read", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function Feed() {
        async function loadMore() {
          const rows = await fetch('/api/items').then((response) => response.json());
          setItems(rows);
        }
        return <button onClick={loadMore} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a synchronous (non-async) handler", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function Sync() {
        const onSubscribe = () => {
          api.post('/x', {});
          setJoined(true);
        };
        return <button onClick={onSubscribe} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when there is no post-await state setter", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function Fire() {
        async function submit() {
          await fetch('/api/x', { method: 'POST' });
        }
        return <button onClick={submit} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the only post-await call is a setTimeout toast dismiss, not a state setter", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function Save({ payload }) {
        async function handleSave() {
          await api.post('/save', payload);
          setTimeout(closeToast, 2000);
        }
        return <button onClick={handleSave} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat a leading setTimeout as a loading-flag guard", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function Save({ payload }) {
        async function handleSave() {
          setTimeout(logAttempt, 0);
          await api.post('/save', payload);
          setSaved(true);
        }
        return <button onClick={handleSave} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a fire-and-report handler whose only setter is error handling in catch", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function Save({ payload }) {
        async function handleSave() {
          try {
            await api.post('/save', payload);
          } catch (error) {
            setError(error);
          }
        }
        return <button onClick={handleSave} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a try/catch-wrapped POST whose state flip follows the await in the same try block", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function Save() {
        async function handleSave() {
          try {
            await fetch('/api/save', { method: 'POST' });
            setSaved(true);
          } catch (err) {
            setError(err);
          }
        }
        return <button onClick={handleSave} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a useCallback-wrapped async handler that POSTs then sets state", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function Save({ payload }) {
        const handleSave = useCallback(async () => {
          await api.post('/save', payload);
          setSaved(true);
        }, [payload]);
        return <button onClick={handleSave} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a guarded useCallback handler with a leading busy early return", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function Save({ payload }) {
        const handleSave = useCallback(async () => {
          if (saving) return;
          setSaving(true);
          await api.post('/save', payload);
          setSaved(true);
        }, [payload, saving]);
        return <button onClick={handleSave} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a non-reentry-guarded event handler such as onChange", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function Input() {
        async function onChangeHandler() {
          await fetch('/api/x', { method: 'POST' });
          setValue(true);
        }
        return <input onChange={onChangeHandler} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Wrap-in-if ref busy guard (no early return)", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function SaveButton({ payload }) {
  const busyRef = useRef(false);
  const handleSave = async () => {
    if (!busyRef.current) {
      busyRef.current = true;
      try {
        await api.post('/save', payload);
        setSaved(true);
      } finally {
        busyRef.current = false;
      }
    }
  };
  return <button onClick={handleSave}>Save</button>;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Wrap-in-if state guard with setSubmitting(true) before the await (real-world outline/outline shape)", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function EmailForm({ onSuccess }) {
  const [email, setEmail] = useState('');
  const [isSubmitting, setSubmitting] = useState(false);
  const handleSubmit = async (event) => {
    event.preventDefault();
    if (email && !isSubmitting) {
      setSubmitting(true);
      try {
        const response = await client.post('/auth/email', { email });
        setSubmitting(false);
        onSuccess(response);
      } catch (error) {
        setSubmitting(false);
      }
    }
  };
  return (
    <form onSubmit={handleSubmit}>
      <input value={email} onChange={(event) => setEmail(event.target.value)} />
      <button type="submit" disabled={isSubmitting}>Continue</button>
    </form>
  );
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: The rule's own recommended remediation: flag set before the await inside try, reset in finally, control disabled", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function PasswordForm({ body }) {
  const [saving, setSaving] = useState(false);
  async function handleSave() {
    try {
      setSaving(true);
      await fetch('/api/password', { method: 'PUT', body });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }
  return <button disabled={saving} onClick={handleSave}>Save</button>;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Formik async onSubmit calling the injected setSubmitting(false) after the await", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function ContactForm() {
  return (
    <Formik
      initialValues={{ message: '' }}
      onSubmit={async (values, { setSubmitting }) => {
        await api.post('/contact', values);
        setSubmitting(false);
      }}
    >
      {({ isSubmitting }) => (
        <Form>
          <Field name="message" />
          <button type="submit" disabled={isSubmitting}>Send</button>
        </Form>
      )}
    </Formik>
  );
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: shadcn/Radix AlertDialogAction confirm-delete (dialog auto-closes on click)", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function DeleteProjectDialog({ projectId, setProjects }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive">Delete project</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogAction
          onClick={async () => {
            await api.delete(\`/projects/\${projectId}\`);
            setProjects((previous) => previous.filter((project) => project.id !== projectId));
          }}
        >
          Confirm
        </AlertDialogAction>
      </AlertDialogContent>
    </AlertDialog>
  );
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Radix DropdownMenuItem async action (menu auto-closes on select)", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function WorkspaceMenu({ workspaceId }) {
  const [archived, setArchived] = useState(false);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>Options</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem
          onClick={async () => {
            await api.post(\`/workspaces/\${workspaceId}/archive\`);
            setArchived(true);
          }}
        >
          Archive
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Local IndexedDB delete via idb — no network request exists", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function NoteRow({ db, noteId }) {
  const [selectedId, setSelectedId] = useState(noteId);
  const handleDelete = async () => {
    await db.delete('notes', noteId);
    setSelectedId(null);
  };
  return <button onClick={handleDelete}>Delete note</button>;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: SWR bound mutate() with no args — a GET revalidation, not a mutation", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function StatsPanel() {
  const stats = useSWR('/api/stats', fetcher);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const handleRefresh = async () => {
    await stats.mutate();
    setLastRefreshed(Date.now());
  };
  return <button onClick={handleRefresh}>Refresh</button>;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Imperative DOM disable of the captured submit button before the await", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function WaitlistForm() {
  const [joined, setJoined] = useState(false);
  const handleSubmit = async (event) => {
    event.preventDefault();
    const submitButton = event.currentTarget.elements.namedItem('join');
    submitButton.disabled = true;
    try {
      await fetch('/api/waitlist', { method: 'POST', body: new FormData(event.currentTarget) });
      setJoined(true);
    } finally {
      submitButton.disabled = false;
    }
  };
  return (
    <form onSubmit={handleSubmit}>
      <button name="join" type="submit">Join waitlist</button>
    </form>
  );
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Cache API caches.delete — local, idempotent, no request", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function ClearCacheButton() {
  const [cleared, setCleared] = useState(false);
  const handleClear = async () => {
    await caches.delete('offline-articles');
    setCleared(true);
  };
  return <button onClick={handleClear}>Clear offline data</button>;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: POST to a preview endpoint — a read-style compute, not a mutation", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function PromptManager({ selectedStage }) {
  const previewStage = async () => {
    const res = await fetch(\`/api/prompts/\${selectedStage}/preview\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testData: {} })
    });
    if (!res.ok) return;
    const data = await res.json();
    setPreview(data.preview);
  };
  return <button onClick={previewStage}>Preview</button>;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: POST to a stop endpoint — idempotent halt, double-fire is harmless", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function Security() {
  const stopMedia = useCallback(async () => {
    await api.post('/media/stop');
    if (videoRef.current) {
      videoRef.current.src = '';
    }
    setStreaming(false);
  }, []);
  return <button onClick={stopMedia}>Stop</button>;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a POST whose template URL ends in a dynamic segment", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function Vote({ pollId }) {
  const castVote = async () => {
    await fetch(\`/api/polls/\${pollId}\`, { method: 'POST' });
    setVoted(true);
  };
  return <button onClick={castVote}>Vote</button>;
}`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an unguarded post-await setter after a mutating request", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function SaveButton({ payload }) {
         const [saved, setSaved] = useState(false);
         const handleSave = async () => {
           await api.post("/save", payload);
           setSaved(true);
         };
         return <button onClick={handleSave}>Save</button>;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a mutate call with arguments (a real mutation)", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function RenameButton({ mutation, name }) {
         const [done, setDone] = useState(false);
         const handleRename = async () => {
           await mutation.mutate({ name });
           setDone(true);
         };
         return <button onClick={handleRename}>Rename</button>;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
