import type { NextAuthConfig } from "next-auth";

import type { AppUserRole } from "./auth-types";

/**
 * Config compartilhada (sem Prisma) para uso no middleware Edge.
 * Os providers com credenciais ficam em `auth.ts`.
 */
const nextAuthUrl = process.env.NEXTAUTH_URL ?? "";

export default {
  /** Garante o mesmo segredo no middleware (Edge) e nos handlers (Node). */
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  trustHost: true,
  /** Em HTTPS, cookies só por canal seguro (mitiga roubo de sessão em redes mistas). */
  useSecureCookies: nextAuthUrl.startsWith("https://"),
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: AppUserRole | null }).role ?? undefined;
        token.organizationId =
          (user as { organizationId?: string | null }).organizationId ?? null;
        token.isSuperAdmin = Boolean(
          (user as { isSuperAdmin?: boolean }).isSuperAdmin,
        );
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        (session.user as { role?: unknown }).role = token.role;
        (session.user as { organizationId?: string | null }).organizationId =
          (token.organizationId as string | null | undefined) ?? null;
        (session.user as { isSuperAdmin?: boolean }).isSuperAdmin = Boolean(
          token.isSuperAdmin,
        );
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
