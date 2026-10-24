export const renderPreview = (url, dimmed) => (
  <img src={url} alt="Preview" style={{ opacity: dimmed ? 0.5 : 1 }} />
);
