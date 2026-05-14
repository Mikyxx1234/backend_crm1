// =============================================================
// ESLint flat config (Next 16 + ESLint 9)
// =============================================================
// `next lint` foi deprecado em Next 16. Esta config substitui o
// fluxo legado e roda via `npm run lint` (ESLint CLI direto).
//
// Base: eslint-config-next (regras Next + react + react-hooks +
// jsx-a11y + import). Extendida com overrides do projeto.
// =============================================================

import nextConfig from "eslint-config-next";

export default [
  ...nextConfig,
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "node_modules/**",
      "next-env.d.ts",
      "coverage/**",
      "prisma/migrations/**",
      "src/generated/**",
    ],
  },
  {
    // Regras "neutras" (sem plugin TS) — valem pra .js/.mjs/.cjs tambem.
    files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    rules: {
      "@next/next/no-img-element": "warn",
      "no-unused-vars": "off",

      // eslint-plugin-react-hooks v7 ativa regras agressivas novas
      // (purity, static-components, refs, set-state-in-effect) que nao
      // eram cobertas pelo `next lint` legado. Marcamos como warn pra
      // sinalizar dividas tecnicas sem bloquear merge enquanto o time
      // refatora os componentes afetados.
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/error-boundaries": "warn",
    },
  },
  {
    // Regras dependentes do plugin @typescript-eslint (registrado pelo
    // bloco `next/typescript` do eslint-config-next, escopado para .ts/.tsx).
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["tests/**/*.{ts,tsx}", "**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // Workers/servicos backend usam convencoes JS server-side que
    // disparam falso-positivo das regras orientadas a React UI:
    // - `usePostgresAuthState`, `useChannelLogger`, etc. nao sao
    //   React hooks.
    // - `<a href>` em emails/templates de admin nao sao Next pages.
    files: [
      "src/workers/**/*.{ts,tsx}",
      "src/services/**/*.{ts,tsx}",
      "src/lib/**/*.{ts,tsx}",
      "scripts/**/*.{ts,tsx}",
    ],
    rules: {
      "react-hooks/rules-of-hooks": "off",
      "react-hooks/exhaustive-deps": "off",
    },
  },
  {
    // App/pages: deixamos warn (nao bloqueia, mas sinaliza dividas
    // tecnicas de a11y/perf reais).
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    rules: {
      "react/no-unescaped-entities": "warn",
      "jsx-a11y/anchor-is-valid": "warn",
      "@next/next/no-html-link-for-pages": "warn",
    },
  },
];
