import { Suspense, use } from "react";

const messageResource = Promise.resolve("ready");

const ResourcePanel = () => <p>{use(messageResource)}</p>;

export const App = () => (
  <Suspense fallback={<p>loading</p>}>
    <ResourcePanel />
  </Suspense>
);
