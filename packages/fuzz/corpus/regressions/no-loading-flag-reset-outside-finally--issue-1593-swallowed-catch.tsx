// verdict: pass
// rule: no-loading-flag-reset-outside-finally
// weakness: control-flow
// source: issue #1593

export const handleUpload = async () => {
  setIsUploading(true);
  try {
    const response = await upload();
    if (response.ok) onSuccess();
    else toast.show({ variant: "danger", label: "Upload failed" });
  } catch {
    toast.show({ variant: "danger", label: "Upload failed" });
  }
  setIsUploading(false);
};
