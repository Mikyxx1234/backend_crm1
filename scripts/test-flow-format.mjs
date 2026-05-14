// Sanity check do formatador de Flow response (formatWhatsappFlowResponse).
// Não toca no banco. Apenas valida formato pra 5 payloads representativos.
//
// Uso: node scripts/test-flow-format.mjs

// Replica da função pra validar isoladamente (sem depender do bundle Next).
// Mantenha em sync com src/lib/meta-webhook/handler.ts:formatWhatsappFlowResponse.
function str(v) { return typeof v === "string" ? v.trim() : ""; }

function formatWhatsappFlowResponse(nfm) {
  const rawJson = nfm.response_json;
  let payload = null;
  if (typeof rawJson === "string" && rawJson.trim().length > 0) {
    try {
      const parsed = JSON.parse(rawJson);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed;
    } catch { return null; }
  } else if (rawJson && typeof rawJson === "object" && !Array.isArray(rawJson)) {
    payload = rawJson;
  }
  if (!payload) return null;
  const entries = Object.entries(payload).filter(([k]) => k !== "flow_token" && !k.startsWith("__"));
  if (entries.length === 0) return null;
  const formatKey = (k) => {
    if (/\s/.test(k) || /[A-Z]/.test(k)) return k;
    const words = k.replace(/[_-]+/g, " ").trim();
    if (!words) return k;
    return words.charAt(0).toUpperCase() + words.slice(1);
  };
  const formatVal = (v) => {
    if (v === null || v === undefined) return "—";
    if (typeof v === "boolean") return v ? "Sim" : "Não";
    if (typeof v === "number") return String(v);
    if (Array.isArray(v)) {
      const joined = v.map((item) => formatVal(item)).join(", ");
      return joined.length > 200 ? `${joined.slice(0, 200)}…` : joined;
    }
    if (typeof v === "object") {
      const json = JSON.stringify(v);
      return json.length > 200 ? `${json.slice(0, 200)}…` : json;
    }
    const s = String(v);
    return s.length > 200 ? `${s.slice(0, 200)}…` : s;
  };
  const flowName = str(nfm.name);
  const header = flowName ? `📋 Resposta do formulário (${flowName})` : `📋 Resposta do formulário`;
  const lines = entries.map(([k, v]) => `• ${formatKey(k)}: ${formatVal(v)}`);
  const full = `${header}\n${lines.join("\n")}`;
  return full.length > 1000 ? `${full.slice(0, 1000)}…` : full;
}

const cases = [
  {
    name: "Caso 1: payload típico do cadastro DNA Work",
    input: {
      name: "cadastro_estagiario",
      body: "Sent",
      response_json: JSON.stringify({
        flow_token: "abc123xyz",
        nome_completo: "Caio Vinicius Pinheiro Silva",
        email: "caio@dnawork.ai",
        telefone: "08092000",
        aceita_marketing: true,
      }),
    },
  },
  {
    name: "Caso 2: response_json como objeto direto (não string)",
    input: {
      body: "Sent",
      response_json: {
        flow_token: "tok",
        primeiro_nome: "Maria",
        idade: 27,
        interesses: ["TI", "Vendas"],
      },
    },
  },
  {
    name: "Caso 3: só flow_token (cliente fechou sem preencher)",
    input: { body: "Sent", response_json: JSON.stringify({ flow_token: "tok123" }) },
  },
  {
    name: "Caso 4: response_json malformado (string não-JSON)",
    input: { body: "Sent", response_json: "este nao eh JSON" },
  },
  {
    name: "Caso 5: payload sem response_json (legacy)",
    input: { body: "Sent" },
  },
  {
    name: "Caso 6: chaves já formatadas + valor null",
    input: {
      name: "lead-quente",
      response_json: JSON.stringify({
        "Nome Completo": "João Silva",
        empresa: null,
        ja_cliente: false,
      }),
    },
  },
];

let failed = 0;
for (const c of cases) {
  console.log(`\n── ${c.name} ──`);
  const out = formatWhatsappFlowResponse(c.input);
  if (out === null) {
    console.log("[retornou null → caller usa fallback]");
  } else {
    console.log(out);
  }
}

console.log(`\n${failed === 0 ? "✓ todos os casos rodaram sem exceção" : `✗ ${failed} casos com erro`}`);
