import { UpcomingEventRow } from "@/components/upcoming/UpcomingEventRow";

// Eight rows per group at rest; the rest stay one click away, under the same
// "Show all N" control the page had before.
const VISIBLE = 8;

function Group({ group }) {
  const events = group.items;
  const first = events.slice(0, VISIBLE);
  const rest = events.slice(VISIBLE);
  const headingId = `upcoming-${group.key.replace(/[^a-z0-9-]/gi, "-")}`;

  return (
    <section
      aria-labelledby={headingId}
      data-upcoming-group={group.key}
      className="mt-7 first:mt-0"
    >
      <div className="sticky top-(--sh-header-clear) z-10 flex items-baseline justify-between gap-3 border-b border-(--sh-line-1) bg-(--sh-surface-overlay) px-1 py-2.5 backdrop-blur-xl">
        <h2
          id={headingId}
          className="text-strong font-semibold tracking-[-0.02em] text-(--sh-text-1)"
        >
          {group.label}
        </h2>
        <span className="text-micro tabular-nums text-(--sh-text-3)">
          {events.length}
        </span>
      </div>

      <ul>
        {first.map(({ event, theme }) => (
          <UpcomingEventRow
            key={event.event_id}
            event={event}
            themeSlug={theme.slug}
            themeName={theme.name}
          />
        ))}
      </ul>

      {rest.length > 0 ? (
        <details className="group border-b border-(--sh-line-1)">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-1 text-micro font-medium text-(--sh-text-2) transition-colors hover:bg-(--sh-hover) focus-visible:bg-(--sh-hover) [&::-webkit-details-marker]:hidden">
            <svg
              viewBox="0 0 12 12"
              className="h-2.5 w-2.5 transition-transform motion-reduce:transition-none group-open:rotate-180"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              aria-hidden="true"
            >
              <path d="M2.5 4.5 6 8l3.5-3.5" />
            </svg>
            Show all {events.length}
          </summary>
          <ul>
            {rest.map(({ event, theme }) => (
              <UpcomingEventRow
                key={event.event_id}
                event={event}
                themeSlug={theme.slug}
                themeName={theme.name}
              />
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

export function UpcomingGroups({ groups }) {
  return (
    <div data-upcoming-list="">
      {groups.map((group) => (
        <Group key={group.key} group={group} />
      ))}
    </div>
  );
}
