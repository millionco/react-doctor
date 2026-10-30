import { useEffect, useState } from "react";

export const StatusPanel = () => {
  const [request, setRequest] = useState("");
  const [visible, setVisible] = useState(0);
  useEffect(() => {
    if (request.length > 3) setRequest("");
  }, [request]);
  useEffect(() => {
    setVisible(request.length);
  }, [request]);
  return <button onClick={() => setRequest("go")}>{visible}</button>;
};
