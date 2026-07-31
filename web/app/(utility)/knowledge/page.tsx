"use client";

import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { RoleGuard } from "@/components/auth/RoleGuard";
import KnowledgePage from "@/components/knowledge/KnowledgePage";

export default function Page() {
  return (
    <RoleGuard allow={["admin"]}>
      <Suspense
        fallback={
          <div className="flex min-h-[50vh] items-center justify-center text-[13px] text-[var(--muted-foreground)]">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        }
      >
        <KnowledgePage />
      </Suspense>
    </RoleGuard>
  );
}
