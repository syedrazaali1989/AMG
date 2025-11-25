import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Trading Signals - 90% Accurate Forex & Crypto Signals",
  description: "Professional trading signals for Forex and Cryptocurrency markets with 90%+ accuracy. Get spot and future trading signals with advanced technical analysis.",
  keywords: ["forex signals", "crypto signals", "trading signals", "technical analysis", "spot trading", "futures trading"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} antialiased`}>
        <main className="min-h-screen">
          {children}
        </main>
      </body>
    </html>
  );
}
