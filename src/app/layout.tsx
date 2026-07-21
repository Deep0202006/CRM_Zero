import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import DashboardLayout from "@/components/DashboardLayout";
export const metadata: Metadata = { title: "ZeroData", description: "Enterprise OS for Field, Support, and Admin Operations.", icons: { icon: "/favicon-32x32.png" }, manifest: "/manifest.json" };
export const viewport: Viewport = { themeColor: "#2563EB", width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en" className="h-full antialiased"><body className="min-h-full flex flex-col bg-canvas text-slate-600 selection:bg-brand-primary selection:text-white"><AuthProvider><DashboardLayout>{children}</DashboardLayout></AuthProvider></body></html>; }
