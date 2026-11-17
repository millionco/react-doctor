// rule: react-router-no-navigate-in-render
// weakness: alias-guard
// source: independent synthetic native submit runtime binding control
// verdict: pass
import "react";
import { useNavigate } from "react-router-dom";
export const Screen = () => {
  const navigate = useNavigate();
  const CREATE_SESSION = async () => {
    await Promise.resolve();
    navigate("/next");
  };
  const onSubmit = (event: { preventDefault: () => void }) => {
    interface CREATE_SESSION {}
    event.preventDefault();
    CREATE_SESSION();
  };
  return (
    <form onSubmit={onSubmit}>
      <button type="submit">Go</button>
    </form>
  );
};
