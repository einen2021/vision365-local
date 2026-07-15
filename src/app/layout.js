import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/toaster";
import { RoleGuard } from "@/components/role-guard";
import { AppProvider } from "@/contexts/AppContext";
import { AssetTypeIconsProvider } from "@/contexts/AssetTypeIconsContext";
import { DesktopProvider } from "@/components/desktop-provider";
import { FirePanelProvider } from "@/components/fire-panel-provider";
import { AssetFireStatusProvider } from "@/components/asset-fire-status-provider";
import { FireAlertProvider } from "@/contexts/FireModalContext";
import { LivePanelAlertProvider } from "@/contexts/LivePanelAlertContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "Vision365",
  description: "Building management platform with JSON data store",
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <DesktopProvider>
            <FirePanelProvider>
              <AssetFireStatusProvider>
                <FireAlertProvider>
                  <LivePanelAlertProvider>
                    <AppProvider>
                      <AssetTypeIconsProvider>
                        <RoleGuard>{children}</RoleGuard>
                      </AssetTypeIconsProvider>
                      <Toaster />
                    </AppProvider>
                  </LivePanelAlertProvider>
                </FireAlertProvider>
              </AssetFireStatusProvider>
            </FirePanelProvider>
          </DesktopProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
