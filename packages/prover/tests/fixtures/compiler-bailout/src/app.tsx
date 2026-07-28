export const App = () => {
  class LocalModel {
    value = "Ready";
  }
  const model = new LocalModel();
  return <p>{model.value}</p>;
};
