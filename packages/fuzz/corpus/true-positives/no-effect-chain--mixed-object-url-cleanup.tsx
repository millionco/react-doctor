// rule: no-effect-chain
// weakness: control-flow
// source: React Bench RD 0.9.3 second-pass FN-001

import { useEffect, useState } from "react";

interface ImageProps {
  data?: Blob;
  imgError?: Error;
  onError: (error: Error) => void;
}

export const Image = ({ data, imgError, onError }: ImageProps) => {
  const [error, setError] = useState<Error>();
  const [imageObjectUrl, setImageObjectUrl] = useState<string>();

  useEffect(() => {
    if (error) onError(error);
  }, [error, onError]);

  useEffect(() => {
    if (imgError) {
      setError(imgError);
      return undefined;
    }
    const nextImageObjectUrl = data && URL.createObjectURL(data);
    if (nextImageObjectUrl) {
      setImageObjectUrl(nextImageObjectUrl);
      return () => URL.revokeObjectURL(nextImageObjectUrl);
    }
    return undefined;
  }, [data, imgError]);

  return imageObjectUrl;
};
