// rule: no-loading-flag-reset-outside-finally
// weakness: async-boundary
// source: synthetic native parity regression
export const save = async () => {
  setLoading(true);
  try {
    await request();
  } finally {
    notify?.(false);
    setLoading(false);
  }
};
