"""Route templates and calendar feed names shared by logs and exports."""

from __future__ import annotations

PAGE_ROUTES = (
    "/",
    "/regime",
    "/convergence",
    "/patterns",
    "/disclaimer",
    "/upcoming",
    "/recessions",
    "/declines",
    "/tested",
)
PAGE_TEMPLATES = (*PAGE_ROUTES, "other")

CALENDAR_FEEDS = (
    "all",
    "science",
    "finance",
    "culture-religion",
    "politics",
    "natural-disasters",
)


def page_template(path: str) -> str:
    """Known page path or ``other``; query strings are ignored."""
    clean = (path or "").split("?", 1)[0]
    return clean if clean in PAGE_ROUTES else "other"


def calendar_feed(path: str) -> str | None:
    """The feed slug for /calendar/<slug>.ics, or None."""
    clean = (path or "").split("?", 1)[0]
    if not clean.startswith("/calendar/") or not clean.endswith(".ics"):
        return None
    slug = clean[len("/calendar/") : -len(".ics")]
    return slug if slug in CALENDAR_FEEDS else None
