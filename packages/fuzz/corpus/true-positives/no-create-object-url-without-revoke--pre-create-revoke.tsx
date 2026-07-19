const renderPreview = (blob: Blob) => URL.createObjectURL(blob);

let url = getPreviousPreview();
URL.revokeObjectURL(url);
url = renderPreview(blob);
