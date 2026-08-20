"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import { Mail, Lock, Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/db";
import { supabase } from "@/lib/supabaseClient";
import styles from "./page.module.css";

export default function LoginPage() {
  const { currentUser, login, isLoading, isErpPartnerViewer } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowSplash(false);
    }, 1800); // Give it enough time for the fade-out animation to finish
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    if (isErpPartnerViewer) { window.location.href = "/erp/distributors"; return; }
    const todayStr = new Date().toISOString().slice(0, 10);
    db.attendance
      .where("[user_id+date]")
      .equals([currentUser.user_id, todayStr])
      .first()
      .then((record) => {
        window.location.href = record ? "/my-day" : "/attendance";
      })
      .catch(() => {
        window.location.href = "/attendance";
      });
  }, [currentUser, isErpPartnerViewer]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMsg(null);
    if (!email.trim() || !password.trim()) {
      setErrorMsg("Enter your ZeroData username and access password.");
      return;
    }
    const success = await login(email, password);
    if (success) {
      const userId = (await supabase.auth.getUser()).data.user?.id;
      const caps = userId ? await db.user_capabilities.where("user_id").equals(userId).toArray() : [];
      window.location.href = caps.some((capability) => capability.capability_code === "erp_partner_viewer") ? "/erp/distributors" : "/attendance";
    } else {
      setErrorMsg("We could not verify these credentials. Check the username and password, then try again.");
    }
  };

  if (showSplash) {
    return (
      <main className={styles.splashPage}>
        <div className={styles.splashContainer}>
          <Image
            src="/ZeroData_Logo.png"
            alt="ZeroData Logo"
            width={320}
            height={160}
            className={styles.splashLogo}
            style={{ height: "auto" }}
            priority
          />
        </div>
      </main>
    );
  }

  return (
    <main className={styles.loginPage}>
      <div className={styles.loginStage}>
        <div className={styles.loginCard}>
          <Image
            src="/login/zerodata-login-logo.png"
            alt="ZeroData Logo"
            width={360}
            height={90}
            className={styles.logo}
            priority
          />
          <Image
            src="/login/crm-login-illustration.png"
            alt="CRM Illustration"
            width={415}
            height={250}
            className={styles.illustration}
            priority
          />
          
          <h1 className={styles.title}>
            Welcome to <span className={styles.titleBlue}>CRM</span>
          </h1>
          <p className={styles.subtitle}>Sign in to your account</p>
          
          <div className={styles.underline} />

          <form onSubmit={handleSubmit} className={styles.form} noValidate>
            {errorMsg && (
              <div className={styles.errorBanner} role="alert">
                {errorMsg}
              </div>
            )}

            <div className={styles.inputGroup}>
              <div className={styles.inputWrapper}>
                <Mail size={20} className={styles.inputIcon} />
                <input
                  id="email"
                  type="text"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Username"
                  className={styles.inputField}
                  required
                />
              </div>
            </div>

            <div className={styles.inputGroup}>
              <div className={styles.inputWrapper}>
                <Lock size={20} className={styles.inputIcon} />
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  className={styles.inputField}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className={styles.inputEye}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            <div className={styles.utilityRow}>
              <label className={styles.checkboxWrapper}>
                <input type="checkbox" className={styles.checkboxInput} />
                <span>Remember me</span>
              </label>
              <a href="#" className={styles.forgotLink}>Forgot Password?</a>
            </div>

            <button
              type="submit"
              className={styles.loginButton}
              disabled={isLoading}
            >
              {isLoading ? "Verifying..." : "Login"}
            </button>

            <div className={styles.trustDivider}>
              <div className={styles.trustLine} />
              <div className={styles.trustContent}>
                <span>Powered by ZERODATA</span>
                <span className={styles.dotSeparator}>·</span>
                <span>V 1.0.1</span>
              </div>
              <div className={styles.trustLine} />
            </div>
          </form>
        </div>
      </div>
      
      <footer className={styles.footer}>
        © 2024 ZeroData. All Rights Reserved.
      </footer>
    </main>
  );
}
