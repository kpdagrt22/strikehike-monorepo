let statusPromise: Promise<boolean> | null = null;

// One status read per page session. The backend answers 404 when the feature is
// off, which hides both the form and the footer line.
export function loadDigestStatus() {
  if (!statusPromise) {
    statusPromise = fetch("/api/digest/status", { cache: "no-store" })
      .then(async (response) => {
        // Read the body even on 404: an unread body keeps Chromium's request
        // open, and every page with SiteColophon would then miss networkidle.
        const payload = await response.json().catch(() => null);
        return response.ok && payload?.enabled === true;
      })
      .catch(() => false);
  }
  return statusPromise;
}
