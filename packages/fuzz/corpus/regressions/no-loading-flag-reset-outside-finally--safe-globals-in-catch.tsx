// rule: no-loading-flag-reset-outside-finally
// verdict: pass
// weakness: control-flow
// source: https://github.com/millionco/react-doctor/issues/1421

const run = async () => {
  setLoading(true);
  const start = performance.now();
  try {
    const res = await fetch(path, { headers: { Accept: "application/json" }, cache: "no-store" });
    const text = await res.text();
    let body = text;
    try {
      body = JSON.stringify(JSON.parse(text), null, 2);
    } catch {}
    setResult({
      status: res.status,
      ok: res.ok,
      body,
      timeMs: Math.round(performance.now() - start),
    });
  } catch (error) {
    setResult({
      status: 0,
      ok: false,
      body: error instanceof Error ? error.message : String(error),
      timeMs: Math.round(performance.now() - start),
    });
  }
  setLoading(false);
};
