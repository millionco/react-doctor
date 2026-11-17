// rule: display-name
// verdict: pass
// weakness: library-idiom
// source: synthetic exported callback data

export default {
  decorators: [(render: () => React.ReactNode) => <section>{render()}</section>],
};
