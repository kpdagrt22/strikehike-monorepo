"use client";

import { useState } from "react";
import { digestSubscribed } from "@/lib/analytics/events";

type Surface = "this_week" | "footer";
type State = "idle" | "sending" | "pending" | "error" | "rate";

export function DigestSignup({ surface = "this_week" }: { surface?: Surface }) {
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState("");

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!consent || state === "sending") return;
    setState("sending");
    setMessage("");
    try {
      const response = await fetch("/api/digest/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, consent, website }),
      });
      // Consume the body on every status; an unread response can keep the
      // connection open and delay networkidle.
      const text = await response.text();
      if (response.status === 202) {
        setState("pending");
        setMessage("Check your inbox to confirm. The link lasts 48 hours.");
        setEmail("");
        setConsent(false);
        digestSubscribed(surface);
        return;
      }
      if (response.status === 429) {
        setState("rate");
        setMessage("Too many requests from here. Please try again later.");
        return;
      }
      if (response.status === 422) {
        let detail = "";
        try {
          detail = JSON.parse(text)?.detail || "";
        } catch {
          detail = "";
        }
        setState("error");
        setMessage(
          detail === "consent_required"
            ? "Please agree to receive the weekly email."
            : "Enter a valid email address.",
        );
        return;
      }
      setState("error");
      setMessage("Couldn't subscribe. Please try again.");
    } catch {
      setState("error");
      setMessage("Couldn't subscribe. Please try again.");
    }
  };

  return (
    <section
      id="weekly-email"
      data-digest-signup={surface}
      aria-labelledby="weekly-email-heading"
      className="mt-8 max-w-[760px] scroll-mt-24 border-t border-(--sh-line-1) pt-5"
    >
      <p className="text-micro uppercase tracking-[0.2em] text-(--sh-signal-ink)">
        Weekly email
      </p>
      <h2
        id="weekly-email-heading"
        className="mt-1 text-strong font-semibold tracking-[-0.02em] text-(--sh-text-1)"
      >
        Get the weekly roundup by email
      </h2>
      <p className="mt-1 text-meta leading-relaxed text-(--sh-text-2)">
        A short weekly note when the sky shifts. Confirm by email; unsubscribe
        in one click.
      </p>
      <form onSubmit={submit} className="mt-3 max-w-[520px]">
        <label
          htmlFor="weekly-email-address"
          className="block text-micro font-medium text-(--sh-text-2)"
        >
          Email
        </label>
        <input
          id="weekly-email-address"
          name="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mt-1 w-full rounded-xl border border-(--sh-line-1) bg-(--sh-surface-card) px-3 py-2.5 text-meta text-(--sh-text-1) outline-none focus:border-(--sh-signal-ink)"
        />
        <label className="mt-3 flex items-start gap-2 text-micro leading-relaxed text-(--sh-text-2)">
          <input
            type="checkbox"
            required
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-(--sh-signal-ink)"
          />
          <span>
            Send me the weekly StrikeHike roundup. Unsubscribe any time.
          </span>
        </label>
        <input
          type="text"
          name="website"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="pointer-events-none absolute -left-[9999px] h-px w-px opacity-0"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={!consent || !email.trim() || state === "sending"}
            className="inline-flex min-h-9 items-center rounded-full border border-(--sh-line-1) px-3 text-micro font-medium text-(--sh-text-1) transition-colors hover:bg-(--sh-hover) disabled:cursor-not-allowed disabled:opacity-40"
          >
            {state === "sending" ? "Sending…" : "Subscribe"}
          </button>
          <span
            aria-live="polite"
            data-digest-message
            className={`text-micro ${
              state === "pending"
                ? "text-(--sh-text-1)"
                : "text-(--sh-text-3)"
            }`}
          >
            {message}
          </span>
        </div>
      </form>
    </section>
  );
}
