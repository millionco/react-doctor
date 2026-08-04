export const App = () => (
  <button
    type="button"
    onClick={() => {
      throw new Error("event failed");
    }}
  >
    fail event
  </button>
);
