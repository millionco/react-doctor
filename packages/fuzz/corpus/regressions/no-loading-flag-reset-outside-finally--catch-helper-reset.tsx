// rule: no-loading-flag-reset-outside-finally
// weakness: control-flow
// source: react-bench corpus audit 2026-07 (glific HSM: the catch clears the flag through a same-file reset helper)
import { useState } from "react";
import { setNotification, uploadMedia } from "./upload-api";

export const TemplateAttachment = () => {
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [attachmentURL, setAttachmentURL] = useState("");
  const resetUploadState = () => {
    setUploadingFile(false);
    setUploadedFile(null);
  };
  const handleFileUpload = async (file: File) => {
    setUploadedFile(file);
    setUploadingFile(true);
    try {
      const result = await uploadMedia({ variables: { media: file } });
      setAttachmentURL(result.data.uploadMedia);
      setUploadingFile(false);
    } catch {
      setNotification("File upload failed. Please try again.", "error");
      resetUploadState();
    }
  };
  return (
    <div>
      <input
        type="file"
        aria-label="Attachment"
        disabled={uploadingFile}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFileUpload(file);
        }}
      />
      {uploadedFile && attachmentURL ? <p>Uploaded</p> : null}
    </div>
  );
};
