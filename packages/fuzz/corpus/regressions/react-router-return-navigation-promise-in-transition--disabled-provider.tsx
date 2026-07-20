// rule: react-router-return-navigation-promise-in-transition
// weakness: static-boolean
// source: Bugbot PR #1411

import { startTransition } from "react";
import { RouterProvider, useNavigate } from "react-router";

export const App = ({ router }) => <RouterProvider router={router} useTransitions={false} />;

export const NavigationButton = () => {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => startTransition(() => void navigate("/next"))}>
      Next
    </button>
  );
};
