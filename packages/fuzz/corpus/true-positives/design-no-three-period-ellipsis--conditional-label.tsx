const AddButton = ({ isAdding }: { isAdding: boolean }) => (
  <button>{isAdding ? "Adding..." : "Add decision"}</button>
);

export default AddButton;
