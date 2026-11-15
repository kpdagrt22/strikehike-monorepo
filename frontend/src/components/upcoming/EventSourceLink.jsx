// A source link beside a dated row. Server component: the click is recorded by
// the one EventActionTracker on the page, so a row does not hydrate an island.
export function EventSourceLink({
  eventId,
  eventName,
  theme,
  daysUntil,
  sourceUrl,
  verification,
}) {
  const label = verification === "computed" ? "Method" : "Source";
  return (
    <a
      href={sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      data-event-action="source"
      data-event-id={eventId}
      data-event-theme={theme}
      data-event-days={daysUntil ?? undefined}
      data-event-source={sourceUrl}
      aria-label={`${label} for ${eventName}`}
      className="sh-row-source"
    >
      {label}
      <svg
        viewBox="0 0 12 12"
        className="h-2.5 w-2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        aria-hidden="true"
      >
        <path d="M4 2h6v6M10 2L2 10" />
      </svg>
    </a>
  );
}
