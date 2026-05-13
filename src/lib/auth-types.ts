import "next-auth";

/** Alinhado ao enum `UserRole` do Prisma (evita depender da geração do client no typecheck). */
export type AppUserRole = "ADMIN" | "MANAGER" | "MEMBER";

declare module "next-auth" {
  interface User {
    role?: AppUserRole;
  }
  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      role: AppUserRole;
      // Espelha `User.avatarUrl` via callback `session` em `src/lib/auth.ts`.
      // É opcional porque usuários sem foto ficam com `null`, e nullable
      // porque pode voltar vazio do banco.
      image?: string | null;
    };
  }
}

