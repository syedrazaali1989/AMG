import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { SignalProvider } from "@/components/providers/SignalProvider";
import { PwaSetup } from "@/components/providers/PwaSetup";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Trading Signals - 75% Accurate Forex & Crypto Signals",
  description: "Professional futures trading signals for Forex and Cryptocurrency markets with 75%+ accuracy. Get futures trading signals with advanced technical analysis.",
  keywords: ["forex signals", "crypto signals", "trading signals", "technical analysis", "futures trading"],
  // The PWA manifest itself is served by src/app/manifest.ts (Next.js
  // links it automatically). App icons are code-generated routes under
  // src/app/icons/, referenced by the manifest. There is no favicon,
  // by the owner's decision.
  appleWebApp: {
    capable: true,
    title: "AMG Trading",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <SignalProvider>
          {children}
        </SignalProvider>
        <PwaSetup />
      </body>
    </html>
  );
}
