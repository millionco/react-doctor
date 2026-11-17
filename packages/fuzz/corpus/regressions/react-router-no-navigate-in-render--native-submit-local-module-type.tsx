// rule: react-router-no-navigate-in-render
// weakness: alias-guard
// source: independent synthetic native submit runtime binding control
// verdict: pass
import "react";
import { useNavigate } from "react-router-dom";
const module = { require: (_source: string) => ({ useNavigate: 0 }) };
interface module {}
const loadedRouter = module.require("react-router-dom");
loadedRouter.useNavigate = 1;
export const Screen = () => {
  const navigate = useNavigate();
  const CREATE_SESSION = () => {
    navigate("/next");
  };
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
