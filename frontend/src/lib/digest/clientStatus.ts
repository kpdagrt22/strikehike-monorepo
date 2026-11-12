let statusPromise: Promise<boolean> | null = null;

// One status read per page session. The backend answers 404 when the feature is
// off, which hides both the form and the footer line.
export function loadDigestStatus() {
  if (!statusPromise) {
    statusPromise = fetch("/api/digest/status", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return false;
        const payload = await response.json().catch(() => null);
        return payload?.enabled === true;
      })
      .catch(() => false);
  }
  return statusPromise;
}
