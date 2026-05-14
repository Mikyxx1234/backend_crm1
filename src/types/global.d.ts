/**
 * Ambient declarations para side-effect imports que o TS não resolve
 * sozinho (packages sem .d.ts, CSS, fontes bundadas pelo Next).
 *
 * Mantém o IDE limpo sem precisar tocar em cada arquivo consumidor.
 */

// Fontes variáveis do @fontsource (só têm .css, sem types)
declare module "@fontsource-variable/inter";
declare module "@fontsource-variable/manrope";

// CSS side-effect imports (globals.css, reactflow styles, etc.)
declare module "*.css";
declare module "reactflow/dist/style.css";
