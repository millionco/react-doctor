// rule: no-create-object-url-without-revoke
// verdict: safe
import { useEffect, useRef, useState } from "react";
export const Preview = ({ data }) => {
  const owned = useRef();
  const [preview, setPreview] = useState();
  useEffect(
    () => () => {
      if (owned.current) URL.revokeObjectURL(owned.current);
    },
    [],
  );
  useEffect(() => {
    const url = data && URL.createObjectURL(data);
    if (url) {
      if (owned.current) URL.revokeObjectURL(owned.current);
      owned.current = url;
      setPreview(url);
    }
  }, [data]);
  return <img src={preview} />;
};
