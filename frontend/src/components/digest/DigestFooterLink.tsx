"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { loadDigestStatus } from "@/lib/digest/clientStatus";

// One quiet line, rendered only when the backend says the digest is on.
export function DigestFooterLink({ className }: { className?: string }) {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let alive = true;
    loadDigestStatus().then((value) => {
      if (alive) setEnabled(value);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!enabled) return null;
  return (
    <Link
      href="/this-week?digest=footer#weekly-email"
      data-digest-footer-link=""
      className={className}
    >
      Get the weekly roundup by email
    </Link>
  );
}
