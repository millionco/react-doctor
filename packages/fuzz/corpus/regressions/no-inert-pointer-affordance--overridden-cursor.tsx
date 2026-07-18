// rule: no-inert-pointer-affordance
// weakness: other
// source: PR #1337 detector audit

const StaticCursor = () => <div className="cursor-pointer cursor-default">Preview</div>;

export default StaticCursor;
