import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "EduIT CRM API",
  description: "Backend API do CRM EduIT",
};

/** Layout mínimo — este app expõe principalmente rotas /api. */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
