"use client";

import { AuthProvider } from "@/context/AuthContext";
import DashboardLayout from "@/components/DashboardLayout";

export default function AuthorizedCrmShell({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <AuthProvider>
      <DashboardLayout>{children}</DashboardLayout>
    </AuthProvider>
  );
}
