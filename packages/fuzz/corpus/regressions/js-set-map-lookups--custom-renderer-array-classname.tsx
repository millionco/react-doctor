// rule: js-set-map-lookups
// verdict: fail
// weakness: library-idiom
// source: independently synthetic custom renderer with an array field
const Markdown = ({ components }) => components.code({ className: ["language-sample"] });
export const Example = ({ blocks }) => (
  <section>
    {blocks.map((block) => (
      <Markdown
        key={block}
        components={{
          code({ className }) {
            return <code>{className?.includes("language-sample")}</code>;
          },
        }}
      >
        {block}
      </Markdown>
    ))}
  </section>
);
