// Bare shell — each memory page owns its own padding + scroll behavior.
// Hub uses `overflow-y-auto` with a max-width container; the L2/L3
// workbench pages use a full-height flex column with internal scrolling
// per pane (preview / LLM workspace) so the outer page never grows.
//
// Memory is admin-only: the RoleGuard here blocks direct URL access (and
// every sub-route — /memory/l1, /memory/l2, …) for students and
// instructors, redirecting them to "/". Auth-disabled deployments are
// unaffected (treated as admin server-side).
import { RoleGuard } from "@/components/auth/RoleGuard";

export default function MemoryLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <RoleGuard allow={["admin"]} redirectTo="/">
      <main className="flex h-full min-h-0 flex-col bg-[var(--background)]">
        {children}
      </main>
    </RoleGuard>
  );
}
