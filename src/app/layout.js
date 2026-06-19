import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/toaster";
import { RoleGuard } from "@/components/role-guard";
import { AppProvider } from "@/contexts/AppContext";
import { DesktopProvider } from "@/components/desktop-provider";
import { FirePanelProvider } from "@/components/fire-panel-provider";
import { AssetFireStatusProvider } from "@/components/asset-fire-status-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "Vision365 Minimal",
  description: "Building management platform with JSON data store",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <DesktopProvider>
            <FirePanelProvider>
              <AssetFireStatusProvider>
                <AppProvider>
                  <RoleGuard>{children}</RoleGuard>
                  <Toaster />
                </AppProvider>
              </AssetFireStatusProvider>
            </FirePanelProvider>
          </DesktopProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
