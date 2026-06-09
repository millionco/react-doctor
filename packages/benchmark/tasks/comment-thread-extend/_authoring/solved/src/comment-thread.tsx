export interface Comment {
  id: string;
  author: string;
  text: string;
  replies: number;
}

export interface CommentThreadProps {
  comments: Comment[];
}

const CommentRow = ({ comment }: { comment: Comment }) => (
  <li>
    {comment.author}: {comment.text} ({comment.replies} replies)
  </li>
);

export const CommentThread = ({ comments }: CommentThreadProps) => (
  <ul className="thread">
    {comments.map((comment) => (
      <CommentRow key={comment.id} comment={comment} />
    ))}
  </ul>
);
