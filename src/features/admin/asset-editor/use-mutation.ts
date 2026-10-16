"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api-client";

/** Runs an API call, toasts the outcome and refreshes the server-rendered page. */
export function useMutation() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(
    async <T,>(key: string, fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      setBusy(key);
      try {
        const r = await fn();
        if (success) toast.ok(success);
        router.refresh();
        return r;
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : "That didn't work. Check your connection and try again.");
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [router],
  );
  return { busy, run };
}
