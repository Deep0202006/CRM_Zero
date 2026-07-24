"use client";

import React, { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/db";
import {
  ArrowDown,
  ArrowRight,
  BarChart3,
  Check,
  Eye,
  EyeOff,
  Layers,
  Lock,
  Mail,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export default function LoginPage() {
  const { currentUser, login, isLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showIntro, setShowIntro] = useState(true);
  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!currentUser) return;
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
  }, [currentUser]);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => setShowIntro(false), reducedMotion ? 240 : 1200);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-scroll-reveal]"));
    if (!nodes.length) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      nodes.forEach((node) => node.setAttribute("data-visible", "true"));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).setAttribute("data-visible", "true");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.18, rootMargin: "0px 0px -8%" }
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [showIntro]);


  const scrollToElement = (element: HTMLElement | null, block: ScrollLogicalPosition = "start") => {
    if (!element) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMsg(null);
    if (!email.trim() || !password.trim()) {
      setErrorMsg("Enter your ZeroData username and access password.");
      return;
    }
    const success = await login(email, password);
    if (success) {
      window.location.href = "/attendance";
    } else {
      setErrorMsg("We could not verify these credentials. Check the username and password, then try again.");
    }
  };

  const presets = [
    { name: "Alice", email: "admin@zerodata", role: "Administrator workspace" },
    { name: "Prince", email: "prince@zerodata", role: "Retailer sales workspace" },
  ];

  return (
    <main className="min-h-screen bg-[var(--surface-primary)] text-[var(--text-primary)]">
      {showIntro && (
        <div className="fixed inset-0 z-[200] grid place-items-center overflow-hidden bg-white" aria-label="ZeroData is loading">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,var(--surface-brand-haze-strong),transparent_34rem)]" />
          <div className="animate-logo-reveal relative flex w-[min(78vw,560px)] flex-col items-center">
            <Image
              src="/ZeroData_Logo.png"
              alt="ZeroData — Your data is yours"
              width={820}
              height={280}
              className="h-auto w-full object-contain"
              priority
            />
            <div className="mt-5 h-[2px] w-32 origin-center overflow-hidden rounded-full bg-[var(--brand-100)]">
              <span className="block h-full w-full origin-left bg-[var(--brand-500)] animate-[zd-pulse-line_1.2s_var(--ease-enter)_both]" />
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowIntro(false)}
            className="absolute bottom-7 right-7 rounded-[var(--radius-md)] px-3 py-2 text-[11px] font-semibold text-[var(--text-muted)] hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]"
          >
            Skip intro
          </button>
        </div>
      )}

      <section className="grid min-h-[100svh] lg:grid-cols-[1.12fr_0.88fr]">
        <div className="relative hidden lg:flex min-h-[58svh] overflow-y-auto overflow-x-hidden bg-[var(--surface-sidebar)] text-white lg:min-h-[100svh]">
          <div className="login-grid-pattern absolute inset-0 opacity-70 pointer-events-none" />
          <div className="absolute -left-24 top-12 h-72 w-72 rounded-full bg-[var(--brand-500)]/20 blur-[90px] pointer-events-none" />
          <div className="absolute -bottom-28 right-0 h-96 w-96 rounded-full bg-[var(--chart-2)]/15 blur-[110px] pointer-events-none" />

          <div className="relative z-10 flex w-full flex-col gap-12 p-6 sm:p-9 lg:p-12 xl:p-16 min-h-max">
            <div className="flex items-center justify-between gap-4 shrink-0">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center overflow-hidden rounded-[12px] bg-white">
                  <Image src="/logo-icon.png" alt="" width={36} height={36} className="h-9 w-9 object-cover" priority />
                </span>
                <div>
                  <p className="text-[15px] font-bold tracking-[0.16em] text-white">ZERODATA</p>
                  <p className="mt-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--text-inverse-muted)]">Operations CRM</p>
                </div>
              </div>
              <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-3 py-1.5 text-[10px] font-semibold text-[var(--text-inverse-muted)] sm:flex">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand-300)] shadow-[0_0_0_4px_var(--brand-ring-soft)]" />
                Secure team workspace
              </div>
            </div>

            <div className="max-w-2xl shrink-0">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--brand-300)]">
                <Sparkles size={13} /> Operational intelligence
              </span>
              <h1 className="mt-6 text-[clamp(2rem,6vw,4.5rem)] font-semibold leading-[1.2] sm:leading-[1.1] tracking-[-0.04em] sm:tracking-[-0.065em] text-white">
                Every client move,
                <span className="block text-[var(--brand-300)] mt-1 sm:mt-0">clearly connected.</span>
              </h1>
              <p className="mt-6 max-w-xl text-[14px] leading-7 text-[var(--login-copy)] sm:text-[16px]">
                One focused workspace for sales onboarding, field execution, mappings, support, calls, attendance, and team performance.
              </p>

              <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-[11px] font-medium text-[var(--login-copy-strong)]">
                {["Role-aware access", "Offline-ready operations", "Live execution queues"].map((item) => (
                  <span key={item} className="flex items-center gap-2">
                    <span className="grid h-5 w-5 place-items-center rounded-full bg-[var(--brand-400)]/15 text-[var(--brand-300)]"><Check size={12} /></span>
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-8 pt-4 flex flex-col gap-10 shrink-0">
              <div className="relative hidden sm:block max-w-[360px]" aria-hidden="true">
                <div className="animate-float relative overflow-hidden rounded-[24px] border border-white/10 bg-[var(--login-panel)]/85 p-4 shadow-[var(--shadow-login-card)] backdrop-blur-xl">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--login-meta)]">Today</p>
                      <p className="mt-1 text-[14px] font-semibold text-white">Execution pulse</p>
                    </div>
                    <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-[var(--brand-400)]/15 text-[var(--brand-300)]"><BarChart3 size={16} /></span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {[['24', 'Active leads'], ['8', 'Tasks due'], ['5', 'Calls logged'], ['92%', 'SLA health']].map(([value, label]) => (
                      <div key={label} className="rounded-[14px] border border-white/[0.065] bg-white/[0.035] p-3">
                        <p className="text-[22px] font-semibold tracking-[-0.04em] text-white">{value}</p>
                        <p className="mt-1 text-[9px] font-medium uppercase tracking-[0.08em] text-[var(--login-meta)]">{label}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 rounded-[14px] border border-white/[0.065] bg-white/[0.035] p-3">
                    <div className="flex items-center justify-between text-[10px] text-[var(--login-copy)]"><span>Pipeline progress</span><span>68%</span></div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.07]"><div className="h-full w-[68%] rounded-full bg-[var(--brand-400)]" /></div>
                    <div className="mt-4 space-y-2">
                      {[80, 62, 46].map((width, index) => (
                        <div key={width} className="flex items-center gap-2">
                          <span className={`h-6 w-6 rounded-[8px] ${index === 0 ? "bg-[var(--brand-400)]/18" : "bg-white/[0.055]"}`} />
                          <span className="h-2 flex-1 rounded-full bg-white/[0.06]"><span className="block h-full rounded-full bg-white/20" style={{ width: `${width}%` }} /></span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="animate-orbit absolute -right-4 -bottom-4 h-24 w-24 rounded-full border border-dashed border-[var(--brand-300)]/25" />
              </div>

              <button
                type="button"
                onClick={() => scrollToElement(document.getElementById("login-story"))}
                className="flex w-fit items-center gap-3 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--login-muted)] transition hover:text-white"
              >
                <span className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/[0.035]"><ArrowDown size={15} /></span>
                Scroll to explore the workspace
              </button>
            </div>
          </div>
        </div>

        <div ref={formRef} id="login-form" className="relative flex items-start lg:items-center justify-center bg-[var(--surface-canvas)] px-3 pt-2 pb-6 sm:px-10 lg:min-h-[100svh] lg:px-12 xl:px-20">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_10%,var(--surface-brand-haze-medium),transparent_24rem)]" />
          <div className="relative z-10 w-full max-w-[430px]">
            <div className="mb-4 lg:mb-8 mt-2 lg:mt-0">
              <p className="section-kicker text-[var(--brand-600)]">Private team access</p>
              <h2 className="mt-1 lg:mt-3 text-[26px] lg:text-[32px] font-semibold tracking-[-0.045em] text-[var(--text-primary)] sm:text-[38px]">Welcome back.</h2>
              <p className="mt-1 lg:mt-3 text-[12px] lg:text-[13px] leading-5 lg:leading-6 text-[var(--text-muted)]">Sign in to continue to your role-specific ZeroData operations workspace.</p>
            </div>

            <div className="rounded-[var(--radius-xl)] border border-[var(--border-subtle)] bg-[var(--surface-primary)] p-4 sm:p-7 shadow-[var(--shadow-popover)]">
              <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5" noValidate>
                {errorMsg && (
                  <div role="alert" className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--status-danger)]/20 bg-[var(--status-danger-soft)] p-3.5 text-[12px] leading-5 text-[var(--status-danger)]">
                    <ShieldAlert size={17} className="mt-0.5 shrink-0" />
                    <span>{errorMsg}</span>
                  </div>
                )}

                <Input
                  id="email"
                  label="Username"
                  type="text"
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@zerodata"
                  leftIcon={<Mail size={16} />}
                  required
                />

                <Input
                  id="password"
                  label="Access password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter your password"
                  leftIcon={<Lock size={16} />}
                  rightIcon={
                    <button
                      type="button"
                      onClick={() => setShowPassword((visible) => !visible)}
                      className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  }
                  required
                />

                <Button type="submit" size="lg" isLoading={isLoading} trailingIcon={!isLoading ? <ArrowRight size={16} /> : undefined} className="w-full">
                  {isLoading ? "Verifying access" : "Enter workspace"}
                </Button>
              </form>

              {process.env.NEXT_PUBLIC_SHOW_PRESETS === "true" && (
                <div className="mt-4 sm:mt-6 border-t border-[var(--border-subtle)] pt-4 sm:pt-5">
                  <div className="mb-2 sm:mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]"><Sparkles size={13} className="text-[var(--brand-600)]" /> Reviewer presets</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {presets.map((preset) => (
                      <button
                        key={preset.email}
                        type="button"
                        onClick={() => {
                          setEmail(preset.email);
                          setPassword("");
                          setErrorMsg(null);
                        }}
                        className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface-secondary)] p-3 text-left transition hover:border-[var(--brand-300)] hover:bg-[var(--brand-50)]"
                      >
                        <span className="block text-[12px] font-semibold text-[var(--text-primary)]">{preset.name}</span>
                        <span className="mt-1 block truncate text-[10px] text-[var(--text-muted)]">{preset.role}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-5 flex items-center justify-center gap-2 text-[10px] font-medium text-[var(--text-muted)]">
              <ShieldCheck size={13} className="text-[var(--brand-600)]" />
              Authenticated through ZeroData&apos;s secure workspace
            </div>
          </div>
        </div>
      </section>

      <section id="login-story" className="login-story-section relative overflow-hidden bg-[var(--surface-canvas)] px-5 py-20 sm:px-10 sm:py-28 lg:px-16">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--border-default)] to-transparent" />
        <div className="mx-auto max-w-7xl">
          <div className="scroll-reveal max-w-3xl" data-scroll-reveal>
            <p className="section-kicker text-[var(--brand-600)]">Built around real work</p>
            <h2 className="mt-4 text-[clamp(2rem,4vw,4.5rem)] font-semibold leading-[1.02] tracking-[-0.055em] text-[var(--text-primary)]">
              Less dashboard theatre.
              <span className="block text-[var(--text-muted)]">More operational control.</span>
            </h2>
            <p className="mt-5 max-w-2xl text-[14px] leading-7 text-[var(--text-muted)]">The interface keeps daily tasks, clients, pipeline movement, service requests, attendance, and team performance in one precise system.</p>
          </div>

          <div className="mt-16 grid gap-5 lg:grid-cols-3">
            {[
              {
                icon: <Layers size={21} />,
                number: "01",
                title: "One connected workflow",
                copy: "Move from client context to calls, follow-ups, support, and pipeline stages without losing operational history.",
              },
              {
                icon: <Users size={21} />,
                number: "02",
                title: "Role-specific clarity",
                copy: "Each team member sees the actions, queues, and data relevant to their permissions and responsibilities.",
              },
              {
                icon: <BarChart3 size={21} />,
                number: "03",
                title: "Decisions, not decoration",
                copy: "Metrics are tied to queues, targets, deadlines, and next actions—so every number has an operational purpose.",
              },
            ].map((item, index) => (
              <article
                key={item.number}
                className="scroll-reveal group relative min-h-[310px] overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border-subtle)] bg-[var(--surface-primary)] p-6 shadow-[var(--shadow-raised)] transition hover:-translate-y-1 hover:border-[var(--brand-200)] hover:shadow-[var(--shadow-card-hover)] sm:p-8"
                data-scroll-reveal
                style={{ transitionDelay: `${index * 80}ms` }}
              >
                <div className="absolute right-5 top-4 text-[54px] font-semibold tracking-[-0.06em] text-[var(--surface-tertiary)] transition group-hover:text-[var(--brand-50)]">{item.number}</div>
                <div className="relative flex h-full flex-col">
                  <span className="grid h-11 w-11 place-items-center rounded-[var(--radius-lg)] bg-[var(--brand-50)] text-[var(--brand-700)]">{item.icon}</span>
                  <div className="mt-auto pt-20">
                    <h3 className="text-[20px] font-semibold tracking-[-0.035em] text-[var(--text-primary)]">{item.title}</h3>
                    <p className="mt-3 text-[13px] leading-6 text-[var(--text-muted)]">{item.copy}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>

          <div className="scroll-reveal mt-16 flex flex-col items-start justify-between gap-6 rounded-[var(--radius-xl)] bg-[var(--surface-sidebar)] p-7 text-white sm:flex-row sm:items-center sm:p-9" data-scroll-reveal>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--brand-300)]">Ready for today&apos;s work?</p>
              <h3 className="mt-2 text-[24px] font-semibold tracking-[-0.04em] text-white">Return to secure sign in.</h3>
            </div>
            <Button size="lg" onClick={() => scrollToElement(formRef.current, "center")} trailingIcon={<ArrowRight size={16} />}>
              Go to login
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}
