// rule: no-loading-flag-reset-outside-finally
// weakness: iterable-protocol
// source: adversarial review
// verdict: fail

export const TaskLoader = () => {
  const [isLoading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    await Promise.allSettled({
      [Symbol.iterator]() {
        throw new Error("iterator failed");
      },
    });
    setLoading(false);
  };

  return <button onClick={load}>{isLoading ? "Loading" : "Load"}</button>;
};
