// rule: no-loading-flag-reset-outside-finally
// weakness: call-argument-evaluation
// source: adversarial review
// verdict: fail

export const TaskLoader = () => {
  const [isLoading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    await Promise.allSettled(getTasks());
    setLoading(false);
  };

  return <button onClick={load}>{isLoading ? "Loading" : "Load"}</button>;
};
