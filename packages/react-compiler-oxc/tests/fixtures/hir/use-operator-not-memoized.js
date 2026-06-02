import {use} from 'react';

const FooContext = React.createContext(null);

function Component(props) {
  const input = use(FooContext);
  return [input];
}
