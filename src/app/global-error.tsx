"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en-GB">
      <body style={{ background: "#1b1a18", color: "#e8e3d6", fontFamily: "system-ui, sans-serif", padding: "4rem 1.5rem" }}>
        <h1 style={{ fontSize: "1.75rem" }}>LOWPO11Y is having trouble loading</h1>
        <p style={{ color: "#a29c8f", maxWidth: "52ch" }}>
          An unexpected error stopped the page from rendering. Reload to try again.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{ marginTop: "1rem", background: "#e2a03c", color: "#1b1a18", border: 0, padding: "0.6rem 1rem", borderRadius: 3 }}
        >
          Reload
        </button>
      </body>
    </html>
  );
}
