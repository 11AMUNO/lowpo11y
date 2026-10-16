"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api-client";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api("/api/auth/logout", { method: "POST", body: {} });
          router.replace("/auth/login");
          router.refresh();
        } catch {
          toast.error("Sign-out failed", "Try again.");
          setBusy(false);
        }
      }}
    >
      Sign out
    </Button>
  );
}
