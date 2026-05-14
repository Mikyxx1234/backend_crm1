import type { Metadata, Viewport } from "next";
import { Outfit } from "next/font/google";
import { Toaster } from "sonner";
import "@fontsource-variable/inter";
import "@fontsource-variable/manrope";

import { auth } from "@/lib/auth";
import "@/lib/auth-types";

import { Providers } from "./providers";
import "./globals.css";

/* Outfit via next/font: bundling local + preload + zero FOUT.
   Mais robusto que `@import` da CDN no globals.css — garante a fonte
   carregada antes do primeiro paint. A variável é exposta como classe
   no <html> para complementar o `font-family: var(--font-sans)`
   declarado em @layer base. */
const outfit = Outfit({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  display: "swap",
  variable: "--font-display-next",
});

export const metadata: Metadata = {
  title: "EduIT CRM",
  description: "CRM para gestão de relacionamento com clientes",
  applicationName: "EduIT",
  // PWA / iOS standalone — quando instalado na home, abre fullscreen
  // com a barra de status preta translucida (Safari respeita "default"
  // mais "black-translucent": o conteudo passa por baixo da status bar
  // e aproveitamos o env(safe-area-inset-top) pra empurrar o conteudo).
  appleWebApp: {
    capable: true,
    title: "EduIT",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
  },
  // Manifest: gerado dinamicamente em /manifest.webmanifest pelo
  // arquivo app/manifest.ts. O Next 15 ja injeta o <link> automatico
  // via metadata API quando o arquivo esta presente — declaramos
  // aqui apenas para garantir override consistente.
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon", sizes: "32x32", type: "image/png" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: [
      { url: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  },
};

/* Viewport mobile-first:
   - `width=device-width` + `initialScale=1` → escala correta no celular.
   - `viewportFit: "cover"` → usa safe-area do iPhone (notch/home indicator)
     com env(safe-area-inset-*); combinado com utilities `.pb-safe` etc.
   - `maximumScale=5` (não 1) → permite zoom acessibilidade.
   - `themeColor` navy combina com a sidebar e address bar do Chrome Android. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#0d1b3e",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();

  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={outfit.variable}
      data-chat-theme="azul"
      style={{ fontFamily: "var(--font-sans)" }}
    >
      <body className="min-h-dvh font-sans antialiased">
        <Providers session={session}>{children}</Providers>
        <Toaster
          position="bottom-right"
          richColors
          toastOptions={{
            style: {
              borderRadius: "14px",
              fontFamily: "var(--font-sans)",
            },
          }}
        />
      </body>
    </html>
  );
}
