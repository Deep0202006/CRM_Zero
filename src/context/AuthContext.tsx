"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { db, LocalUser } from "@/lib/db";
import { supabase } from "@/lib/supabaseClient";

interface AuthContextType {
  currentUser: LocalUser | null;
  capabilities: string[];
  allUsers: LocalUser[];
  isLoading: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  // Role flags
  isAdmin: boolean;
  isTechSupport: boolean;
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
        if (savedUserId) {
          const matchedUser = users.find(u => u.user_id === savedUserId);
          if (matchedUser) {
            setCurrentUser(matchedUser);
            const caps = await db.user_capabilities.where("user_id").equals(matchedUser.user_id).toArray();
            setCapabilities(caps.map(c => c.capability_code));
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
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (error) {
        console.error("Supabase login error:", error.message);
        setIsLoading(false);
        return false;
      }

      if (data.user) {
        // Find matching local user by email
        let user = await db.users.where("email").equals(data.user.email!).first();
        
        // If not found locally, fetch from Supabase
        if (!user) {
          console.log("User not in local DB, fetching from Supabase...");
          const { data: remoteUser, error: remoteError } = await supabase
            .from("users")
            .select("*")
            .eq("email", data.user.email!)
            .single();
            
          if (remoteError || !remoteUser) {
            console.error("Failed to fetch user from Supabase:", remoteError);
          } else {
            const newUser = {
              ...remoteUser,
              is_active: remoteUser.is_active ? 1 : 0
            } as any;
            user = newUser;
            await db.users.put(newUser);
            
            // Also fetch capabilities
            const { data: remoteCaps } = await supabase
              .from("user_capabilities")
              .select("*")
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
          setIsLoading(false);
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

  const logout = async () => {
    setIsLoading(true);
    await supabase.auth.signOut();
    setCurrentUser(null);
    setCapabilities([]);
    localStorage.removeItem("authenticated_user_id");
    setIsLoading(false);
    if (typeof window !== "undefined") window.location.href = "/login";
  };

  // ─── Derived role flags ──────────────────────────────────────────────────
  const isAdmin              = capabilities.includes("admin");
  const isTechSupport        = capabilities.includes("tech_support") || isAdmin;

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
        const todayStr = new Date().toISOString().slice(0, 10);
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
          await db.attendance.add(newRecord);
          await db.sync_queue.add({ idempotency_key: crypto.randomUUID(), 
            table_name: "attendance",
            action: "INSERT",
            data: newRecord,
            timestamp: new Date().toISOString(),
          });
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
