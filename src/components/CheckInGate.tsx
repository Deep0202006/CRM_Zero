"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/db";
import { getCurrentISTDate } from "@/lib/dateTime";
import { Button } from "@/components/ui/Button";
import Link from "next/link";
import { ShieldAlert, LogIn } from "lucide-react";

export function CheckInGate({ children }: { children: React.ReactNode }) {
  const { currentUser, isFieldStaff } = useAuth();
  const [hasClockedIn, setHasClockedIn] = useState<boolean | null>(null);

  useEffect(() => {
    async function checkAttendance() {
      if (!currentUser || !isFieldStaff) {
        setHasClockedIn(true);
        return;
      }
      try {
        const todayStr = getCurrentISTDate();
        const records = await db.attendance.where("user_id").equals(currentUser.user_id).toArray();
        const clockedInToday = records.some((r) => r.date === todayStr);
        setHasClockedIn(clockedInToday);
      } catch (err) {
        console.error("Failed to verify clock-in status", err);
        setHasClockedIn(false);
      }
    }
    checkAttendance();
  }, [currentUser, isFieldStaff]);

  if (hasClockedIn === null) {
    return <div className="p-8 text-center text-[var(--text-muted)] text-[13px]">Verifying attendance...</div>;
  }

  if (!hasClockedIn) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center">
        <span className="mb-4 grid h-12 w-12 place-items-center rounded-full bg-[var(--status-warning-soft)] text-[var(--status-warning)]">
          <ShieldAlert size={24} />
        </span>
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Attendance Required</h2>
        <p className="mt-2 max-w-sm text-[13px] text-[var(--text-secondary)]">
          You must clock in with a verification selfie before you can log field visits or access this section.
        </p>
        <Link href="/attendance" className="mt-6 inline-flex">
          <Button icon={<LogIn size={15} />}>Go to clock in</Button>
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
