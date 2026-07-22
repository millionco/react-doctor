// rule: no-loading-flag-reset-outside-finally
// weakness: global-provenance
// source: adversarial review of issue #1421
// verdict: fail

const formatDuration = () => {
  throw new Error("formatting failed");
};

const run = async () => {
  setLoading(true);
  try {
    await load();
  } catch (error) {
    const method = "round";
    Math[method](formatDuration());
    JSON.parse(String(error));
  }
  setLoading(false);
};
