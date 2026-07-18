const UploadControl = () => (
  <label>
    <input className="peer opacity-0" type="file" />
    <span className="peer-focus-visible:ring-2">Upload</span>
  </label>
);

export default UploadControl;
