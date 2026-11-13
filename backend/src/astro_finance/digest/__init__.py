"""Double opt-in subscribers and the weekly Resend digest.

The module is deliberately separate from the analytics store: its SQLite file
sits beside the analytics database on the same persistent volume, but email
addresses never enter analytics events or the weekly export.
"""

from .store import DigestStore, get_store

__all__ = ["DigestStore", "get_store"]
