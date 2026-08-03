"use client";

interface AdminLinkProps {
  collapsed?: boolean;
}

// After issues #9 and #10, neither role needs this footer link:
//  - Admins reach Accounts Management via the Settings hub (issue #9).
//  - Instructors reach their course units via the "My Course Units"
//    primary nav entry placed below "Browse Courses" (issue #10).
// The component is retained for import compatibility but renders nothing.
export function AdminLink({ collapsed: _collapsed = false }: AdminLinkProps) {
  return null;
}
