import React from "react";

interface BadgeProps {
  children: React.ReactNode;
  className?: string;
}

const Badge = ({ children, className }: BadgeProps) => (
  <span className={className}>{children}</span>
);

export const CompactInlineSurfaces = () => (
  <>
    <span className="rounded bg-slate-200 px-2 py-1">Status</span>
    <button className="rounded bg-blue-600 px-3 py-1.5">Save</button>
    <Badge className="border p-1">New</Badge>
  </>
);
