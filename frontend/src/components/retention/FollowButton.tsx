"use client";

import { useFollowed } from "@/hooks/useRetention";
import { themeFollowed } from "@/lib/analytics/events";
import { setFollowed } from "@/lib/retention/storage";

// The follow state is local to this browser. Storage failure is silent: the
// in-memory cache still toggles for the current page.
export function FollowButton({
  theme,
  name,
  compact = false,
}: {
  theme: string;
  name?: string;
  compact?: boolean;
}) {
  const followed = useFollowed();
  const on = followed.includes(theme);
  const label = name ? `${on ? "Following" : "Follow"} ${name}` : on ? "Following" : "Follow";

  return (
    <button
      type="button"
      data-follow-toggle={theme}
      aria-pressed={on}
      aria-label={label}
      onClick={() => {
        const next = on
          ? followed.filter((id) => id !== theme)
          : [...followed, theme];
        setFollowed(next);
        themeFollowed(theme, on ? "unfollow" : "follow");
      }}
      className={`inline-flex shrink-0 items-center justify-center gap-1 rounded-full border font-medium transition-colors focus-visible:bg-(--sh-hover) ${
        compact ? "min-h-9 px-2.5 text-micro" : "min-h-10 px-3 text-micro"
      } ${
        on
          ? "border-(--sh-signal-ink)/35 bg-(--sh-selected) text-(--sh-text-1)"
          : "border-(--sh-line-1) text-(--sh-text-2) hover:bg-(--sh-hover) hover:text-(--sh-text-1)"
      }`}
    >
      <svg
        viewBox="0 0 16 16"
        className="h-3 w-3"
        fill={on ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m8 2.3 1.7 3.5 3.8.5-2.8 2.7.7 3.8L8 11l-3.4 1.8.7-3.8L2.5 6.3l3.8-.5z" />
      </svg>
      {on ? "Following" : "Follow"}
    </button>
  );
}
