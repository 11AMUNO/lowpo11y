"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/feedback";

export default function SiteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
      <ErrorState
        title="This page failed to load"
        action={
          <Button variant="primary" onClick={reset}>
            Try again
          </Button>
        }
      >
        <p>
          Something went wrong on our side while building this page. Trying again usually fixes it.
          {error.digest ? <span className="type-data mt-2 block text-muted">Reference {error.digest}</span> : null}
        </p>
      </ErrorState>
    </div>
  );
}
