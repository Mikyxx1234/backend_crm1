/**
 * Resolve post Click-to-WhatsApp → ad metadata via Meta Marketing API.
 *
 * Cenário típico: anúncio promovendo um post existente do Facebook. Quando
 * o usuário clica, a Meta envia no webhook `referral.source_type = "post"`
 * + `source_id = <POST_ID>`, mas NÃO envia o `ad_id`. Este serviço resolve
 * o post para metadados do anúncio chamando o Graph API.
 *
 * - Reusa o token do canal Meta (META_WHATSAPP_ACCESS_TOKEN ou o
 *   token do canal). Se o token não tiver permissão `ads_read`, retorna
 *   `no_access` (não-fatal).
 * - Grava resultado nos campos `ad_resolved_*` do contato; replica para
 *   outros contatos da mesma org com o mesmo `ad_source_id` para evitar
 *   chamar a API novamente (cache de fato é o próprio banco).
 */
import { prisma } from "@/lib/prisma";
import { getLogger } from "@/lib/logger";

const log = getLogger("meta-ad-resolver");

const GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION?.trim() || "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

type ResolveStatus = "ok" | "not_found" | "no_access" | "rate_limited" | "error";

type ResolvedAd = {
  adId: string | null;
  adName: string | null;
  adsetId: string | null;
  adsetName: string | null;
  campaignId: string | null;
  campaignName: string | null;
};

type ResolutionResult = {
  status: ResolveStatus;
  error: string | null;
  data: ResolvedAd | null;
};

/**
 * Endpoint principal: GET /{post_id}/promotion_info — retorna metadados
 * do anúncio que promove o post (ad_id, ad_object_story_id, etc.).
 * Documentação: https://developers.facebook.com/docs/graph-api/reference/post/
 *
 * Tem uma limitação: só funciona se o token tiver `pages_read_engagement`
 * e/ou `ads_management` no escopo do System User, e se o post for de
 * uma Page conectada à mesma conta de negócios.
 */
async function fetchAdFromPost(
  postId: string,
  accessToken: string,
): Promise<ResolutionResult> {
  // Tentativa 1: /{post_id} com fields=promotion_info (Meta docs estável)
  // Se falhar, tentativa 2: /{post_id} com fields=ads (mais raro mas usado em alguns Business Manager).
  const url = new URL(`${GRAPH_BASE}/${encodeURIComponent(postId)}`);
  url.searchParams.set(
    "fields",
    "id,promotion_info{ad_id,ad_object_story_id},ads{id,name,adset{id,name,campaign{id,name}}}",
  );

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (err) {
    return {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      data: null,
    };
  }

  if (res.status === 401 || res.status === 403) {
    return { status: "no_access", error: `HTTP ${res.status}`, data: null };
  }
  if (res.status === 429) {
    return { status: "rate_limited", error: "HTTP 429", data: null };
  }
  if (res.status === 404) {
    return { status: "not_found", error: "HTTP 404 do post", data: null };
  }
  if (!res.ok) {
    let body = "";
    try {
      body = (await res.text()).slice(0, 500);
    } catch {
      // ignore
    }
    return { status: "error", error: `HTTP ${res.status} ${body}`, data: null };
  }

  let json: Record<string, unknown>;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch (err) {
    return {
      status: "error",
      error: err instanceof Error ? err.message : "Invalid JSON",
      data: null,
    };
  }

  // Caminho 1: promotion_info preenchido
  const promo = json.promotion_info as Record<string, unknown> | undefined;
  let adId = typeof promo?.ad_id === "string" ? promo.ad_id : null;

  // Caminho 2: edge `ads` (lista) — pega o primeiro ativo
  let adFromList: Record<string, unknown> | null = null;
  if (!adId) {
    const adsObj = json.ads as Record<string, unknown> | undefined;
    const adsList = Array.isArray(adsObj?.data) ? (adsObj?.data as Record<string, unknown>[]) : [];
    if (adsList.length > 0) {
      adFromList = adsList[0];
      const id = adFromList?.id;
      if (typeof id === "string") adId = id;
    }
  }

  if (!adId) {
    return { status: "not_found", error: "post sem ad associado", data: null };
  }

  // Se vier pelo caminho 2, já temos name/adset/campaign no objeto retornado.
  // Se vier só pelo caminho 1 (promotion_info), faz GET /{ad_id} para enriquecer.
  let adName: string | null = null;
  let adsetId: string | null = null;
  let adsetName: string | null = null;
  let campaignId: string | null = null;
  let campaignName: string | null = null;

  if (adFromList) {
    if (typeof adFromList.name === "string") adName = adFromList.name;
    const adset = adFromList.adset as Record<string, unknown> | undefined;
    if (adset) {
      if (typeof adset.id === "string") adsetId = adset.id;
      if (typeof adset.name === "string") adsetName = adset.name;
      const camp = adset.campaign as Record<string, unknown> | undefined;
      if (camp) {
        if (typeof camp.id === "string") campaignId = camp.id;
        if (typeof camp.name === "string") campaignName = camp.name;
      }
    }
  } else {
    // Enriquecer via /{ad_id}
    try {
      const adUrl = new URL(`${GRAPH_BASE}/${encodeURIComponent(adId)}`);
      adUrl.searchParams.set("fields", "id,name,adset{id,name,campaign{id,name}}");
      const r = await fetch(adUrl.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (r.ok) {
        const a = (await r.json()) as Record<string, unknown>;
        if (typeof a.name === "string") adName = a.name;
        const adset = a.adset as Record<string, unknown> | undefined;
        if (adset) {
          if (typeof adset.id === "string") adsetId = adset.id;
          if (typeof adset.name === "string") adsetName = adset.name;
          const camp = adset.campaign as Record<string, unknown> | undefined;
          if (camp) {
            if (typeof camp.id === "string") campaignId = camp.id;
            if (typeof camp.name === "string") campaignName = camp.name;
          }
        }
      }
    } catch {
      // metadados extras são opcionais — o ad_id já é suficiente
    }
  }

  return {
    status: "ok",
    error: null,
    data: { adId, adName, adsetId, adsetName, campaignId, campaignName },
  };
}

/**
 * Tenta resolver pelo cache (banco): se outro contato da mesma org já
 * tem o mesmo `ad_source_id` resolvido com sucesso recentemente (< 24h),
 * reusa os dados sem chamar a Meta de novo.
 */
async function lookupCache(
  organizationId: string,
  sourceId: string,
): Promise<ResolvedAd | null> {
  const TTL_HOURS = 24;
  const since = new Date(Date.now() - TTL_HOURS * 60 * 60 * 1000);
  const cached = await prisma.contact.findFirst({
    where: {
      organizationId,
      adSourceId: sourceId,
      adResolveStatus: "ok",
      adResolvedAt: { gte: since },
      adResolvedId: { not: null },
    },
    select: {
      adResolvedId: true,
      adResolvedName: true,
      adResolvedAdsetId: true,
      adResolvedAdsetName: true,
      adResolvedCampaignId: true,
      adResolvedCampaignName: true,
    },
    orderBy: { adResolvedAt: "desc" },
  });
  if (!cached?.adResolvedId) return null;
  return {
    adId: cached.adResolvedId,
    adName: cached.adResolvedName,
    adsetId: cached.adResolvedAdsetId,
    adsetName: cached.adResolvedAdsetName,
    campaignId: cached.adResolvedCampaignId,
    campaignName: cached.adResolvedCampaignName,
  };
}

/**
 * Função pública — chame com `void` no handler do webhook para não
 * bloquear a resposta 200 à Meta. Faz cache lookup primeiro; se cache
 * miss, chama Graph API; persiste o resultado no contato.
 */
export async function resolveAdAndPersistAsync(args: {
  contactId: string;
  organizationId: string;
  sourceId: string;
  accessToken: string | null;
}): Promise<void> {
  const { contactId, organizationId, sourceId, accessToken } = args;
  if (!accessToken) {
    await prisma.contact
      .update({
        where: { id: contactId },
        data: {
          adResolveStatus: "no_access",
          adResolveError: "accessToken indisponível",
          adResolvedAt: new Date(),
        },
      })
      .catch((e) => log.debug("falha ao gravar no_access (não-fatal):", e));
    return;
  }

  // Cache lookup
  const cached = await lookupCache(organizationId, sourceId).catch(() => null);
  if (cached) {
    await prisma.contact
      .update({
        where: { id: contactId },
        data: {
          adResolvedId: cached.adId,
          adResolvedName: cached.adName,
          adResolvedAdsetId: cached.adsetId,
          adResolvedAdsetName: cached.adsetName,
          adResolvedCampaignId: cached.campaignId,
          adResolvedCampaignName: cached.campaignName,
          adResolvedAt: new Date(),
          adResolveStatus: "ok",
          adResolveError: null,
        },
      })
      .catch((e) => log.debug("falha ao gravar resultado cache (não-fatal):", e));
    log.info(
      `Ad resolvido via cache — contato=${contactId} post=${sourceId} ad=${cached.adId}`,
    );
    return;
  }

  // Cache miss → Meta API
  const result = await fetchAdFromPost(sourceId, accessToken);

  await prisma.contact
    .update({
      where: { id: contactId },
      data: {
        adResolvedId: result.data?.adId ?? null,
        adResolvedName: result.data?.adName ?? null,
        adResolvedAdsetId: result.data?.adsetId ?? null,
        adResolvedAdsetName: result.data?.adsetName ?? null,
        adResolvedCampaignId: result.data?.campaignId ?? null,
        adResolvedCampaignName: result.data?.campaignName ?? null,
        adResolvedAt: new Date(),
        adResolveStatus: result.status,
        adResolveError: result.error,
      },
    })
    .catch((e) => log.error("Falha ao persistir resolução do ad:", e));

  if (result.status === "ok") {
    log.info(
      `Ad resolvido via Meta — contato=${contactId} post=${sourceId} ad=${result.data?.adId} campanha="${result.data?.campaignName ?? "—"}"`,
    );
  } else {
    log.warn(
      `Falha ao resolver post→ad — contato=${contactId} post=${sourceId} status=${result.status} erro=${result.error ?? "—"}`,
    );
  }
}
