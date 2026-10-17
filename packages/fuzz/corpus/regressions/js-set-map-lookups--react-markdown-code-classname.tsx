// rule: js-set-map-lookups
// verdict: pass
// weakness: library-idiom
// source: independently synthetic canonical ReactMarkdown code renderer
import Markdown from "react-markdown";
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
