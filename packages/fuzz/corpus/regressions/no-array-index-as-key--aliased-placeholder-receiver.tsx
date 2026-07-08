// rule: no-array-index-as-key
// weakness: copy-tracking
// source: corpus census (ant-design BannerRecommends skeleton list)
export const SkeletonRow = () => {
  const list = Array.from({ length: 3 });
  return (
    <div>
      {list.map((_, index) => (
        <div key={`skeleton-${index}`} />
      ))}
    </div>
  );
};
