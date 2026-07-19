// rule: no-broken-image-source
// weakness: imperative-ref
// source: RDE OSS corpus, edp963/davinci webapp

import { useEffect, useRef } from "react";

interface LazyImageProps {
  readonly source: string;
}

export const LazyImage = ({ source }: LazyImageProps) => {
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const image = imageRef.current;
    if (image) image.src = source;
  }, [source]);

  return <img ref={imageRef} alt="Lazy preview" />;
};
