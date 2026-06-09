export interface Comment {
  id: string;
  author: string;
  text: string;
  replies: number;
}

export interface CommentThreadProps {
  comments: Comment[];
}

export const CommentThread = ({ comments }: CommentThreadProps) => {
  const Item = (props: any) => (
    <li>
      {props.author}: {props.text}
    </li>
  );
  return (
    <ul className="thread">
      {comments.map((comment, index) => (
        <Item key={index} author={comment.author} text={comment.text} />
      ))}
    </ul>
  );
};
