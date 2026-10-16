"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en-GB">
      <body style={{ background: "#000", color: "#f2f2f2", fontFamily: "ui-monospace, Menlo, monospace", padding: "4rem 1.5rem" }}>
        <h1 style={{ fontSize: "1.25rem", letterSpacing: "0.08em", textTransform: "uppercase" }}>! LOWPO11Y failed to load</h1>
        <p style={{ color: "#8e8e8e", maxWidth: "52ch" }}>
          An unexpected error stopped the page from rendering. Reload to try again.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{ marginTop: "1rem", background: "#000", color: "#fff", border: "1px solid #fff", padding: "0.5rem 0.9rem", fontFamily: "inherit", textTransform: "uppercase", letterSpacing: "0.05em" }}
        >
          [ Reload ]
        </button>
      </body>
    </html>
  );
}
