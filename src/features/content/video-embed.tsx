"use client";

import { useState } from "react";

/**
 * Click-to-load YouTube player. Nothing is requested from YouTube until the
 * visitor presses play: no iframe, no thumbnail, no cookies. Then the
 * privacy-enhanced youtube-nocookie.com embed loads, as YouTube's embed
 * terms allow.
 */
export function VideoEmbed({ videoId, title, watchUrl }: { videoId: string; title: string; watchUrl: string }) {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="relative aspect-video w-full overflow-hidden border border-rule-strong bg-sunken">
      {playing ? (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`}
          title={title}
          className="absolute inset-0 size-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-4 text-center [background:repeating-linear-gradient(0deg,transparent_0_3px,rgba(255,255,255,.025)_3px_4px)]">
          <button
            type="button"
            onClick={() => setPlaying(true)}
            className="group flex cursor-pointer items-center gap-3 border border-bright bg-bg px-5 py-3 font-ocr text-[14px] tracking-[0.12em] text-bright uppercase shadow-[var(--crt-glow)] hover:bg-hover focus-visible:outline-none"
          >
            <span aria-hidden className="text-lg leading-none">
              ▶
            </span>
            Play video<span className="sr-only">: {title}</span>
          </button>
          <p className="max-w-[46ch] text-xs leading-relaxed text-muted">
            Plays from youtube-nocookie.com. Nothing loads from YouTube until you press play; after that, YouTube&apos;s own privacy policy applies.{" "}
            <a href={watchUrl} target="_blank" rel="noopener noreferrer" className="text-bright underline underline-offset-4">
              Watch on YouTube instead
            </a>
          </p>
        </div>
      )}
    </div>
  );
}
