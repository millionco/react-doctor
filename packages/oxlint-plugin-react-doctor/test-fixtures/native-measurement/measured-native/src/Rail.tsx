import { memo } from "react";
import Frame from "src/Frame";
const Rail = memo(function Rail({ wrapper, content, offset, onSwiping, onSwiped }: any) {
  return (
    <Frame onSwiping={onSwiping} onSwiped={onSwiped}>
      <div ref={wrapper}>
        <nav ref={content} style={{ left: offset }}>
          Items
        </nav>
      </div>
    </Frame>
  );
});
export default Rail;
