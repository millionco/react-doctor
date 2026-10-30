// rule: react-router-no-navigate-in-render
// weakness: alias-guard
// source: independent synthetic native submit runtime binding control
// verdict: pass
import { Fragment } from "react";
import { useNavigate } from "react-router-dom";
interface Fragment {}
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
    <Fragment>
      <form onSubmit={onSubmit}>
        <button type="submit">Go</button>
      </form>
    </Fragment>
  );
};
