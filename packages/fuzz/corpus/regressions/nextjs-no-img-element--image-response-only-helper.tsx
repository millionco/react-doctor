// rule: nextjs-no-img-element
// weakness: cross-file
// source: OpenFlipbook apps/web/lib/postcard.tsx at 0f3e745586e432aa184c5555d68bbf734f5ccbb9
interface PostcardImage {
  imageUrl: string;
  title: string;
}

export const postcardLayout = (postcard: PostcardImage) => (
  <div style={{ display: "flex", flexDirection: "column" }}>
    <img src={postcard.imageUrl} alt="" width={1080} height={1010} />
    <span>{postcard.title}</span>
  </div>
);
