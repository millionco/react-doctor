const renderToString = (value: unknown) => String(value);
const hydrateRoot = (_container: Element, value: unknown) => value;

export const App = () => <main>Account</main>;

renderToString(<App />);
hydrateRoot(document.body, <App />);
