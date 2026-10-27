import Image from "next/image";
import Link from "next/link";

const VIEWS = [
  { href: "/", label: "Orrery" },
  { href: "/regime", label: "Regime" },
  { href: "/convergence", label: "Convergence" },
  { href: "/patterns", label: "Study of Patterns" },
];

export default function NotFound() {
  return (
    <main className="relative grid h-[100dvh] w-screen place-items-center overflow-hidden bg-[radial-gradient(ellipse_at_50%_28%,#ffffff_0%,#faf7f2_30%,#f1ebe2_62%,#e3dbcf_100%)] px-4 dark:bg-[radial-gradient(ellipse_at_50%_28%,#232330_0%,#141420_30%,#090910_62%,#020204_100%)]">
      <div className="flex max-w-md flex-col items-center text-center">
        <Image
          src="/icon.png"
          alt=""
          width={48}
          height={48}
          aria-hidden="true"
          draggable={false}
          className="h-12 w-12 rounded-full object-cover ring-1 ring-black/10 dark:ring-white/10"
        />
        <h1 className="mt-6 text-[32px] font-light leading-[1.1] tracking-[-0.04em] text-[#14121a] sm:text-[44px] dark:text-[#f2ede4]">
          Off the timeline.
        </h1>
        <p className="mt-3 text-body leading-relaxed text-black/70 dark:text-white/70">
          This address isn&apos;t part of the engine.
        </p>
        <nav
          aria-label="Engine views"
          className="mt-8 flex flex-wrap justify-center gap-2"
        >
          {VIEWS.map((view) => (
            <Link
              key={view.href}
              href={view.href}
              prefetch={false}
              className="inline-flex h-11 items-center rounded-full border border-black/10 bg-white/45 px-4 text-micro font-medium uppercase tracking-[0.14em] text-black/70 transition-colors duration-(--sh-dur-micro) hover:bg-white/75 hover:text-black/90 focus-visible:bg-white/75 focus-visible:text-black/90 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/70 dark:hover:bg-white/[0.08] dark:hover:text-white/90 dark:focus-visible:bg-white/[0.08] dark:focus-visible:text-white/90"
            >
              {view.label}
            </Link>
          ))}
        </nav>
      </div>
    </main>
  );
}
