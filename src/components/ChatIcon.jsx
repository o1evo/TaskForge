import React from 'react';

// The TaskForge chat glyph — a speech bubble with three dots. Used everywhere the
// UI used to render a 💬 emoji (the header chats control, the floating threads
// bubble, the "Comment" button, per-line comment markers), so the app has one
// consistent, theme-aware icon instead of a platform emoji.
//
// It inherits `currentColor`, so it takes on whatever text color its context sets
// (and themes automatically). Size it with the `size` prop (px).
export default function ChatIcon({ size = 16, strokeWidth = 1.8, style, className, title }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : 'true'}
      role={title ? 'img' : undefined}
      style={{ display: 'inline-block', verticalAlign: '-0.15em', flex: 'none', ...style }}
    >
      {title && <title>{title}</title>}
      <path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.9-.95L3 20.5l1.45-5.6A8.4 8.4 0 0 1 3.5 11 8.5 8.5 0 0 1 12 2.5a8.4 8.4 0 0 1 8.5 8.5Z" />
      <circle cx="8.5" cy="11.5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="12" cy="11.5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="11.5" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}
