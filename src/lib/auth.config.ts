import type { NextAuthConfig } from "next-auth";

/**
 * Config compartilhada (sem Prisma) para uso no middleware Edge.
 * Os providers com credenciais ficam em `auth.ts`.
 */
const nextAuthUrl = process.env.NEXTAUTH_URL ?? "";
const trustHostRaw = process.env.AUTH_TRUST_HOST?.trim().toLowerCase();

export default {
  /** Garante o mesmo segredo no middleware (Edge) e nos handlers (Node). */
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  /** Easypanel / proxy: use AUTH_TRUST_HOST=true (default se não for "false"/"0"). */
  trustHost: trustHostRaw !== "false" && trustHostRaw !== "0",
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
        token.role = (user as { role?: unknown }).role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        (session.user as { role?: unknown }).role = token.role;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
