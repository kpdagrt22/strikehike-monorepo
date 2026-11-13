"use client";

import { useEffect, useState } from "react";
import { loadDigestStatus } from "@/lib/digest/clientStatus";
import { DigestSignup } from "./DigestSignup";

type Surface = "this_week" | "footer";

// Nothing is rendered until the backend says the digest is on, so a disabled
// feature leaves no form in the DOM.
export function DigestSignupGate({ surface = "this_week" }: { surface?: Surface }) {
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
  return <DigestSignup surface={surface} />;
}
