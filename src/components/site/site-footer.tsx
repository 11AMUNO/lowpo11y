import Link from "next/link";
import { FOOTER_NAV } from "./nav";
import { SysClock } from "./sys-clock";
import { Wordmark } from "./logo";

export function SiteFooter() {
  return (
    <footer className="mt-16">
      <div className="mx-auto grid max-w-[105rem] grid-cols-2 gap-x-6 gap-y-8 border-t border-rule-strong px-4 py-10 sm:px-6 md:grid-cols-[1.4fr_repeat(4,1fr)]">
        <div className="col-span-2 max-w-xs md:col-span-1">
          <Wordmark />
          <p className="mt-3 text-xs text-muted">
            Free assets and browser tools for low-poly and retro-styled games. Tools run on your machine; files never
            leave it.
          </p>
        </div>
        {FOOTER_NAV.map((group) => (
          <nav key={group.heading} aria-label={group.heading}>
            <h2 className="type-panel">// {group.heading}</h2>
            <ul className="mt-3 flex flex-col gap-1.5">
              {group.items.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="text-xs text-muted hover:text-bright">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="mx-auto flex max-w-[105rem] flex-wrap justify-between gap-x-6 gap-y-2 border-t border-rule-strong px-4 pt-4 pb-6 font-ocr text-xs tracking-[0.08em] text-muted uppercase sm:px-6">
        <span>LOWPO11Y // not affiliated with Sony, Nintendo or any engine vendor // demo items are CC0</span>
        <SysClock />
      </div>
    </footer>
  );
}
