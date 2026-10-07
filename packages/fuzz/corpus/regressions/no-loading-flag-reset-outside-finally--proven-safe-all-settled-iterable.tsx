// rule: no-loading-flag-reset-outside-finally
// weakness: iterable-protocol
// source: adversarial review
// verdict: pass

export const TaskLoader = () => {
  const [isLoading, setLoading] = useState(false);

  const load = async () => {
    const tasks = [];
    setLoading(true);
    await Promise.allSettled(tasks);
    await Promise.allSettled({
      *[Symbol.iterator]() {
        yield 1;
      },
    });
    setLoading(false);
  };

  return <button onClick={load}>{isLoading ? "Loading" : "Load"}</button>;
};
