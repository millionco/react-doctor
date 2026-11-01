// rule: react-router-no-navigate-in-render
// weakness: control-flow
// source: independent synthetic native submit callback
// verdict: fail
import { useNavigate } from "react-router-dom";

interface SubmitEvent {
  preventDefault(): void;
}

export const SaveScreen = () => {
  const navigate = useNavigate();
  const SAVE_RECORD = () => navigate("/saved");
  const handleSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    SAVE_RECORD();
  };
  SAVE_RECORD();
  return (
    <form onSubmit={handleSubmit}>
      <button type="submit">Save</button>
    </form>
  );
};
