import { CredentialsSignin } from "@auth/core/errors";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";

import authConfig from "./auth.config";
import { prisma } from "./prisma";

/** Código em `signIn(..., { redirect: false })` → `result.code` quando o Prisma falha (ex.: BD parada). */
class DatabaseUnavailable extends CredentialsSignin {
  code = "database_unavailable";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Senha", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const email = String(credentials.email).trim().toLowerCase();

        let user;
        try {
          user = await prisma.user.findUnique({
            where: { email },
          });
        } catch (err) {
          console.error("[auth] authorize: database error", err);
          throw new DatabaseUnavailable();
        }

        if (!user) return null;

        if (user.type === "AI" || !user.hashedPassword) {
          return null;
        }

        const isValid = await compare(
          credentials.password as string,
          user.hashedPassword
        );

        if (!isValid) return null;

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          // NextAuth lê `image` como o avatar do usuário (mapeia pra
          // `session.user.image`). Espelhamos `User.avatarUrl` aqui pra
          // que a foto cadastrada em `/settings/profile` apareça em
          // qualquer componente que use `useSession()` — o avatar do
          // agente vira herança automática em todo o app (chat,
          // kanban, sales hub, etc.).
          image: user.avatarUrl ?? null,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: unknown }).role;
        token.picture = (user as { image?: string | null }).image ?? null;
      } else if (token.id) {
        try {
          // Refresh role + avatarUrl do banco a cada renovação do JWT
          // — garante que se o agente atualizar a foto em
          // `/settings/profile`, a session reflete na próxima
          // requisição sem exigir re-login.
          const dbUser = await prisma.user.findUnique({
            where: { id: token.id as string },
            select: { role: true, avatarUrl: true },
          });
          if (dbUser) {
            token.role = dbUser.role;
            token.picture = dbUser.avatarUrl ?? null;
          }
        } catch (err) {
          console.error("[auth] jwt role refresh failed", err);
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        (session.user as { role?: unknown }).role = token.role;
        // NextAuth NÃO copia automaticamente `token.picture` pra
        // `session.user.image` (apesar de o tipo permitir) — fazemos
        // explicitamente. Sem isso, qualquer componente que tente ler
        // `session.user.image` recebe `undefined` mesmo com a foto
        // já no banco.
        session.user.image = (token.picture as string | null | undefined) ?? null;
      }
      return session;
    },
  },
});
