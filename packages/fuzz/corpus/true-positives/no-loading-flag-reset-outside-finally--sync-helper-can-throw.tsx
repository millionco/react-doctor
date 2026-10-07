// rule: no-loading-flag-reset-outside-finally
// weakness: cross-file
// source: parity audit
// verdict: fail

const waitForUpload = () => {
  recordUploadAttempt();
  return Promise.resolve();
};

export const UploadButton = () => {
  const [isUploading, setIsUploading] = useState(false);

  const upload = async () => {
    setIsUploading(true);
    await waitForUpload();
    setIsUploading(false);
  };

  return <button onClick={upload}>{isUploading ? "Uploading" : "Upload"}</button>;
};
