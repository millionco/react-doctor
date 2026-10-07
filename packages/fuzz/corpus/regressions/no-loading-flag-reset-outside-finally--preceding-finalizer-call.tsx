// rule: no-loading-flag-reset-outside-finally
// weakness: control-flow
// source: GitHub issue #1698
// verdict: pass

export const submitPayment = async () => {
  setIsProcessing(true);
  try {
    await doPayment();
  } catch (error) {
    showSnackbar(String(error), "error");
  } finally {
    guard.unlock();
    setIsProcessing(false);
  }
};
