"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { confirmQueuedAttendance, db, LocalUser, pullDownSync, processSyncQueue, countActiveSyncQueueItems, saveAttendanceWithEvidence } from "@/lib/db";
import { supabase } from "@/lib/supabaseClient";
import { getCurrentISTDate } from "@/lib/dateTime";
import { syncFieldVisits } from "@/lib/fieldVisits/sync";

interface AuthContextType {
  currentUser: LocalUser | null;
  capabilities: string[];
  allUsers: LocalUser[];
  isLoading: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: (selfie?: File) => Promise<{ ok: boolean; error?: string; pendingRetained?: boolean }>;
  // Role flags
  isAdmin: boolean;
  isTechSupport: boolean;
  isTaskAssigner: boolean;
  // Onboarding
  hasDistOnboarding: boolean;
  hasRetOnboarding: boolean;
  hasOnboarding: boolean;         // dist OR ret
  // Support
  hasDistSupport: boolean;
  hasRetSupport: boolean;
  hasSupport: boolean;            // dist OR ret
  // Field
  hasFieldDist: boolean;
  hasFieldRet: boolean;
  hasField: boolean;              // dist OR ret
  // Attendance type
  isFieldStaff: boolean;         // needs selfie clock-in
  isOfficeStaff: boolean;        // instant clock-in
  // Legacy combined (kept for backward compat)
  hasAnySalesOrSupport: boolean;
  refreshCapabilities: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<LocalUser | null>(null);
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [allUsers, setAllUsers] = useState<LocalUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Initialize DB and restore session
  useEffect(() => {
    async function initAuth() {
      try {
        setIsLoading(true);
        const users = await db.users.toArray();
        setAllUsers(users);

        const savedUserId = localStorage.getItem("authenticated_user_id");
        
        // SECURITY FIX: Verify session with Supabase instead of blindly trusting localStorage
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError || !session || session.user.id !== savedUserId) {
          if (savedUserId) {
            const queuedOperations = await countActiveSyncQueueItems();
            if (queuedOperations > 0 && !localStorage.getItem("zerodata_outbox_owner_id")) {
              localStorage.setItem("zerodata_outbox_owner_id", savedUserId);
            }
            console.warn("Local storage session spoofing detected or session expired. Clearing local auth.");
            localStorage.removeItem("authenticated_user_id");
            setCurrentUser(null);
            setCapabilities([]);
          }
          setIsLoading(false);
          return;
        }

        if (savedUserId) {
          const matchedUser = users.find(u => u.user_id === savedUserId);
          if (matchedUser) {
            setCurrentUser(matchedUser);
            const caps = await db.user_capabilities.where("user_id").equals(matchedUser.user_id).toArray();
            setCapabilities(caps.map(c => c.capability_code));
            if (navigator.onLine) void Promise.allSettled([processSyncQueue(), syncFieldVisits(undefined, matchedUser.user_id, "recovery")]);
            // Background pull down to hydrate robust offline DB for 10-person team
            pullDownSync().then(async () => {
              const updatedCaps = await db.user_capabilities.where("user_id").equals(matchedUser.user_id).toArray();
              setCapabilities(updatedCaps.map(c => c.capability_code));
              const updatedUsers = await db.users.toArray();
              setAllUsers(updatedUsers);
            }).catch(console.error);
          } else {
            localStorage.removeItem("authenticated_user_id");
          }
        }
      } catch (err) {
        console.error("Auth initialization failed", err);
      } finally {
        setIsLoading(false);
      }
    }
    initAuth();
  }, []);

  // Client-side route protection
  useEffect(() => {
    if (!isLoading && !currentUser && typeof window !== "undefined") {
      const path = window.location.pathname;
      if (path !== "/login") {
        window.location.href = "/login";
      }
    }
  }, [currentUser, isLoading]);

  const loadUserCapabilities = async (userId: string) => {
    const caps = await db.user_capabilities.where("user_id").equals(userId).toArray();
    setCapabilities(caps.map(c => c.capability_code));
  };

  const refreshCapabilities = async () => {
    if (currentUser) await loadUserCapabilities(currentUser.user_id);
    const users = await db.users.toArray();
    setAllUsers(users);
  };

  const login = async (email: string, password: string): Promise<boolean> => {
    setIsLoading(true);
    try {
      const rawUsername = email.trim().toLowerCase();
      const authEmail = rawUsername.includes('@') ? rawUsername : `${rawUsername}@zerodata.local`;
      
      const { data, error } = await supabase.auth.signInWithPassword({
        email: authEmail,
        password,
      });

      if (error) {
        console.error("Supabase login error:", error.message);
        setIsLoading(false);
        return false;
      }

      if (data.user) {
        const queuedOperations = await db.sync_queue.toArray();
        const pendingLocalVisits = await db.field_visits
          .where("sync_status")
          .anyOf(["pending_sync", "sync_failed"])
          .toArray();
        if (queuedOperations.length > 0 || pendingLocalVisits.length > 0) {
          const explicitOwners = new Set(
            [
              ...queuedOperations.map((item) => item.owner_user_id),
              ...pendingLocalVisits.map((visit) => visit.user_id),
            ]
              .filter((owner): owner is string => Boolean(owner)),
          );
          const storedOwner = localStorage.getItem("zerodata_outbox_owner_id");
          const derivedOwner = explicitOwners.size === 1 ? [...explicitOwners][0] : null;
          const hasUnownedItems = queuedOperations.some((item) => !item.owner_user_id);
          const effectiveOwner = storedOwner ?? derivedOwner;
          const ambiguous =
            explicitOwners.size > 1 ||
            (storedOwner && derivedOwner && storedOwner !== derivedOwner) ||
            (!storedOwner && hasUnownedItems) ||
            !effectiveOwner;
          if (ambiguous || effectiveOwner !== data.user.id) {
            console.warn("Login blocked because unsynchronized work belongs to another user or has ambiguous ownership.");
            await supabase.auth.signOut();
            setIsLoading(false);
            return false;
          }
          localStorage.setItem("zerodata_outbox_owner_id", effectiveOwner);
        }

        // Find matching local user by exact UUID
        let user = await db.users.where("user_id").equals(data.user.id).first();
        
        // If not found locally, fetch from Supabase
        if (!user) {
          console.log("User not in local DB, fetching from Supabase...");
          const { data: remoteUser, error: remoteError } = await supabase
            .from("users")
            .select("user_id,name,email,phone,is_active,manager_id,created_at")
            .eq("user_id", data.user.id)
            .single();
            
          if (remoteError || !remoteUser) {
            console.error("Failed to fetch user from Supabase:", remoteError);
          } else {
            const newUser = {
              ...remoteUser,
              is_active: remoteUser.is_active ? 1 : 0
            } as LocalUser;
            user = newUser;
            await db.users.put(newUser);
            
            // Also fetch capabilities
            const { data: remoteCaps } = await supabase
              .from("user_capabilities")
              .select("id,user_id,capability_code,assigned_by,assigned_at")
              .eq("user_id", newUser.user_id);
              
            if (remoteCaps && remoteCaps.length > 0) {
              await db.user_capabilities.bulkPut(remoteCaps);
            }
          }
        }

        if (user) {
          setCurrentUser(user);
          localStorage.setItem("authenticated_user_id", user.user_id);
          await loadUserCapabilities(user.user_id);
          if (navigator.onLine) void Promise.allSettled([processSyncQueue(), syncFieldVisits(undefined, user.user_id, "recovery")]);
          setIsLoading(false);
          
          // Trigger downward sync to populate the local DB with team data
          pullDownSync().then(async () => {
            const updatedCaps = await db.user_capabilities.where("user_id").equals(user.user_id).toArray();
            setCapabilities(updatedCaps.map(c => c.capability_code));
          }).catch(console.error);
          
          return true;
        } else {
          console.error("User authenticated in Supabase but not found in remote users table.");
        }
      }
      setIsLoading(false);
      return false;
    } catch (err) {
      console.error("Login verification failed", err);
      setIsLoading(false);
      return false;
    }
  };

  const logout = async (selfie?: File) => {
    if (!currentUser) return { ok: false, error: "No authenticated user." };
    setIsLoading(true);
    let pendingRetained = false;
    try {
      if (typeof window !== 'undefined' && navigator.onLine) {
        await Promise.allSettled([processSyncQueue(), syncFieldVisits()]);
      }
      const storedOwner = localStorage.getItem("zerodata_outbox_owner_id");
      const queuedOperations = await db.sync_queue.toArray();
      const ownedOperations = queuedOperations.filter(
        (item) => item.owner_user_id === currentUser.user_id || (!item.owner_user_id && storedOwner === currentUser.user_id),
      );
      const pendingVisits = await db.field_visits
        .where("sync_status")
        .anyOf(["pending_sync", "sync_failed"])
        .and((visit) => visit.user_id === currentUser.user_id)
        .count();
      pendingRetained = ownedOperations.length > 0 || pendingVisits > 0;
      if (pendingRetained) {
        localStorage.setItem("zerodata_outbox_owner_id", currentUser.user_id);
        window.alert("Your unsynced work is safely retained on this device. Sign in with the same account later to complete synchronization.");
      }

      if (!capabilities.includes("admin")) {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) throw new Error("Your session could not be verified.");
        const body = new FormData();
        if (selfie) body.append("selfie", selfie, "clockout.jpg");
        const response = await fetch("/api/attendance/clock-out", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body,
        });
        const result = await response.json() as {
          error?: string;
          attendance_id?: string;
          user_id?: string;
          clock_out?: string;
        };
        if (!response.ok || !result.attendance_id || result.user_id !== currentUser.user_id || !result.clock_out) {
          throw new Error(result.error || "Clock-out was not confirmed.");
        }
        await db.attendance.update(result.attendance_id, { clock_out: result.clock_out });
      }

      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
      setCurrentUser(null);
      setCapabilities([]);
      localStorage.removeItem("authenticated_user_id");
      if (!pendingRetained) localStorage.removeItem("zerodata_outbox_owner_id");
      setIsLoading(false);
      if (typeof window !== "undefined") window.location.href = "/login";
      return { ok: true, pendingRetained };
    } catch (error) {
      console.warn("Verified logout failed", error);
      setIsLoading(false);
      return { ok: false, error: error instanceof Error ? error.message : "Logout failed. Please retry." };
    }
  };

  // ─── Derived role flags ──────────────────────────────────────────────────
  const isAdmin              = capabilities.includes("admin");
  const isTechSupport        = capabilities.includes("tech_support") || isAdmin;
  const isTaskAssigner       = capabilities.includes("task_assigner") || isAdmin;

  const hasDistOnboarding    = capabilities.includes("dist_onboarding") || isAdmin;
  const hasRetOnboarding     = capabilities.includes("ret_onboarding") || isAdmin;
  const hasOnboarding        = hasDistOnboarding || hasRetOnboarding;

  const hasDistSupport       = capabilities.includes("dist_support") || isAdmin;
  const hasRetSupport        = capabilities.includes("ret_support") || isAdmin;
  const hasSupport           = hasDistSupport || hasRetSupport;

  const hasFieldDist         = capabilities.includes("field_dist") || isAdmin;
  const hasFieldRet          = capabilities.includes("field_ret") || isAdmin;
  const hasField             = hasFieldDist || hasFieldRet;

  // Attendance mode detection (strict — admin is neither)
  const isFieldStaff         = (capabilities.includes("field_dist") || capabilities.includes("field_ret")) && !isAdmin;
  const isOfficeStaff        = (hasOnboarding || hasSupport) && !isFieldStaff && !isAdmin;

  // Auto-log attendance for office staff
  useEffect(() => {
    const logOfficeAttendance = async () => {
      if (!currentUser || !isOfficeStaff) return;
      try {
        const todayStr = getCurrentISTDate();
        const records = await db.attendance.where("user_id").equals(currentUser.user_id).toArray();
        const hasToday = records.some(r => r.date === todayStr);
        if (!hasToday) {
          const newRecord = {
            attendance_id: crypto.randomUUID(),
            user_id: currentUser.user_id,
            date: todayStr,
            clock_in: new Date().toISOString(),
            clock_out: null,
            selfie_url: null,
            latitude: null,
            longitude: null
          };
          await saveAttendanceWithEvidence(newRecord, null);
          await confirmQueuedAttendance(newRecord.attendance_id);
        }
      } catch (err) {
        console.error("Auto attendance logging failed", err);
      }
    };
    logOfficeAttendance();
  }, [currentUser, isOfficeStaff]);

  // Legacy compat
  const hasAnySalesOrSupport = hasOnboarding || hasSupport;

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        capabilities,
        allUsers,
        isLoading,
        login,
        logout,
        isAdmin,
        isTechSupport,
        isTaskAssigner,
        hasDistOnboarding,
        hasRetOnboarding,
        hasOnboarding,
        hasDistSupport,
        hasRetSupport,
        hasSupport,
        hasFieldDist,
        hasFieldRet,
        hasField,
        isFieldStaff,
        isOfficeStaff,
        hasAnySalesOrSupport,
        refreshCapabilities,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error("useAuth must be used within an AuthProvider");
  return context;
};
