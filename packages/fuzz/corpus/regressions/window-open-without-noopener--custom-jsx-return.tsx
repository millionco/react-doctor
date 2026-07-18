// rule: window-open-without-noopener
// weakness: custom-callback-return
interface ConsumerProps {
  onClick: () => Window | null;
}

const Consumer = ({ onClick }: ConsumerProps) => onClick();

export const App = (userControlledUrl: string) => (
  <Consumer onClick={() => window.open(userControlledUrl)} />
);
