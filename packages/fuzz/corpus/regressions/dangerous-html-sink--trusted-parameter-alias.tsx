const renderPreview = (element, html) => {
  const content = html;
  element.innerHTML = content;
};

renderPreview(firstPreview, "<p>Static preview</p>");
renderPreview(secondPreview, DOMPurify.sanitize(loadPreview()));
