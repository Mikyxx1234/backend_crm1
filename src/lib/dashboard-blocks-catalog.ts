/**
 * Catalogo oficial dos blocos de analise do dashboard comercial — backend.
 *
 * Fonte de verdade para VALIDACAO e ORDEM PADRAO do layout. O frontend tem
 * o seu proprio catalogo com metadados de render (titulo/descricao); as
 * `key`s precisam ser identicas entre os dois (repos separados).
 *
 * Regras (espelham a sidebar):
 *  - `key` e estavel e nunca deve mudar (e gravada na preferencia do user).
 *  - `locked: true` => bloco nao pode ser ocultado (mas pode ser reordenado).
 *    Ex.: `summary` (KPIs essenciais).
 */

export interface DashboardBlockCatalogItem {
  key: string;
  /** Apenas referencia/documentacao no backend; o render usa o catalogo FE. */
  title: string;
  locked: boolean;
}

/** Ordem do array = ordem padrao dos blocos no dashboard. */
export const DASHBOARD_BLOCKS_CATALOG: readonly DashboardBlockCatalogItem[] = [
  { key: "summary", title: "Indicadores", locked: true },
  { key: "funnel", title: "Funil por etapa", locked: false },
  { key: "dailyEvolution", title: "Evolução diária", locked: false },
  { key: "bySource", title: "Negócios por origem", locked: false },
  { key: "byOwner", title: "Ranking de consultores", locked: false },
  { key: "byTag", title: "Performance por tags", locked: false },
  { key: "lossReasons", title: "Motivos de perda", locked: false },
  { key: "stalled", title: "Leads parados por etapa", locked: false },
] as const;

export const DASHBOARD_BLOCK_KEYS: ReadonlySet<string> = new Set(
  DASHBOARD_BLOCKS_CATALOG.map((b) => b.key),
);

export const DASHBOARD_LOCKED_BLOCK_KEYS: ReadonlySet<string> = new Set(
  DASHBOARD_BLOCKS_CATALOG.filter((b) => b.locked).map((b) => b.key),
);

export function getDashboardBlock(
  key: string,
): DashboardBlockCatalogItem | undefined {
  return DASHBOARD_BLOCKS_CATALOG.find((b) => b.key === key);
}
