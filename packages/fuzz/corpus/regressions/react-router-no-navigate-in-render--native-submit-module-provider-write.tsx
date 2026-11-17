// rule: react-router-no-navigate-in-render
// weakness: control-flow
// source: independent synthetic closed submit provider control
// verdict: fail
import "react";
import { useNavigate } from "react-router-dom";
const loadedRouter = module.require("react-router-dom");
loadedRouter.useNavigate = replacement;
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
