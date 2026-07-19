// rule: query-no-mutation-in-effect-as-read
// weakness: dynamic-computed
// source: deep audit of millionco/react-doctor#1000

import { useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Done } from "./done";

export const Upload = ({ file }: { file: File }) => {
  const { mutateAsync: checkUpload, data } = useMutation({ mutationFn: uploadFile });
  useEffect(() => {
    void checkUpload(file);
  }, [checkUpload, file]);
  const { ["success"]: didSucceed, status } = data;
  return didSucceed && data[`message`] && status ? <Done /> : null;
};
