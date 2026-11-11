"use client";

import { ErrorPanel } from "@/components/states/ErrorPanel";

export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <ErrorPanel reset={reset} />
      </body>
    </html>
  );
}
