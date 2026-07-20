// rule: react-router-return-navigation-promise-in-transition
// weakness: provider-ownership
// source: adversarial contract audit of PR #1411
import { startTransition } from "react";
import { RouterProvider, useNavigate } from "react-router";

export const Apps = ({ firstRouter, secondRouter }) => (
  <>
    <RouterProvider router={firstRouter} useTransitions />
    <RouterProvider router={secondRouter} />
  </>
);

export const Button = () => {
  const navigate = useNavigate();
  return <button onClick={() => startTransition(() => void navigate("/next"))}>Next</button>;
};
