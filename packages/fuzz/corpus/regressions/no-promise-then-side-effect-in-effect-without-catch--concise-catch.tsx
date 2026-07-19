// rule: no-promise-then-side-effect-in-effect-without-catch
// weakness: library-idiom
// source: Daytona parity PR #1402, DylanVann/react-native-fast-image

import { useEffect, useState } from "react";

export const ImageGrid = () => {
  const [images, setImages] = useState<unknown[]>([]);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    fetch("/images")
      .then((response) => response.json())
      .then((nextImages) => setImages(nextImages))
      .catch((reason) => setError(reason));
  }, []);

  return error ? null : <>{images.length}</>;
};
