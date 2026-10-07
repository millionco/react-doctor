// rule: no-monotonous-page-spacing
// weakness: framework-gating
// source: adversarial parity review
// verdict: pass

interface WidgetProps {
  className: string;
}

const Widget = ({ className }: WidgetProps) => <div data-theme={className} />;

export const Page = () => (
  <main>
    <Widget className="p-4" />
    <Widget className="p-4" />
    <Widget className="p-4" />
    <Widget className="p-4" />
    <Widget className="p-4" />
    <Widget className="p-4" />
    <Widget className="p-4" />
    <Widget className="p-4" />
    <Widget className="p-4" />
    <Widget className="p-4" />
    <Widget className="p-4" />
    <Widget className="p-4" />
  </main>
);
