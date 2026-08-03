// rule: no-effect-chain
// verdict: fail
// weakness: control-flow
// source: ReactBench RD093-FN-001

import { useEffect, useState } from "react";

interface ImageProps {
  data?: Blob;
  imageError?: Error;
  onError: (error: Error) => void;
}

export const Image = ({ data, imageError, onError }: ImageProps) => {
  const [error, setError] = useState<Error>();
  const [imageObjectUrl, setImageObjectUrl] = useState<string>();

  useEffect(() => {
    if (error) onError(error);
  }, [error, onError]);

  useEffect(() => {
    if (imageError) {
      setError(imageError);
      return undefined;
    }
    if (!data) return undefined;
    const objectUrl = URL.createObjectURL(data);
    setImageObjectUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [data, imageError]);

  return imageObjectUrl;
};
