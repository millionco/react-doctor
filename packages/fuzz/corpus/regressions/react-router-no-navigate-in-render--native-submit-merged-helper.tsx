// rule: react-router-no-navigate-in-render
// weakness: control-flow
// source: independent synthetic closed submit provider control
// verdict: pass
import "react";
import { useNavigate } from "react-router-dom";
export const Screen = () => {
  const navigate = useNavigate();
  const CREATE_SESSION = () => {
    navigate("/next");
  };
  interface CREATE_SESSION {}
  const onSubmit = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    CREATE_SESSION();
  };
  return (
    <form onSubmit={onSubmit}>
      <button type="submit">Go</button>
    </form>
  );
};
