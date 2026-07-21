import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import DashboardLayout from "@/components/DashboardLayout";

export const metadata: Metadata = {
  title: "ZeroData",
  description: "Enterprise OS for Field, Support, and Admin Operations.",
  icons: { icon: "/favicon-32x32.png" },
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "ZeroData" },
};

export const viewport: Viewport = {
  themeColor: "#2563EB",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <script dangerouslySetInnerHTML={{ __html: `if ('serviceWorker' in navigator) { navigator.serviceWorker.getRegistrations().then(function(registrations) { for (let registration of registrations) { registration.unregister(); } }); }` }} />
      </head>
      <body className="min-h-full flex flex-col bg-canvas text-slate-600 selection:bg-brand-primary selection:text-white">
        <AuthProvider><DashboardLayout>{children}</DashboardLayout></AuthProvider>
      </body>
    </html>
  );
}
