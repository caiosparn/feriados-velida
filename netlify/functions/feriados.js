const https = require("https");

function callAnthropic(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "web-search-2025-03-05",
        "Content-Length": Buffer.byteLength(data),
      },
    };

    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error("Erro ao parsear resposta da API"));
        }
      });
    });

    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método não permitido" }) };
  }

  let cidade, estado, anoInicial, anoFinal;
  try {
    const parsed = JSON.parse(event.body);
    cidade = parsed.cidade;
    estado = parsed.estado;
    anoInicial = parsed.anoInicial;
    anoFinal = parsed.anoFinal;
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Body inválido" }) };
  }

  if (!cidade || !estado || !anoInicial || !anoFinal) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Parâmetros obrigatórios: cidade, estado, anoInicial, anoFinal" }) };
  }

  const anos = [];
  for (let a = parseInt(anoInicial); a <= parseInt(anoFinal); a++) anos.push(a);

  const prompt = `Você é um especialista jurídico em legislação brasileira de feriados. Sua tarefa é pesquisar e listar SOMENTE os feriados OFICIAIS (NÃO inclua pontos facultativos, NÃO inclua carnaval) para o município de ${cidade}, estado ${estado}, nos anos: ${anos.join(", ")}.

INSTRUÇÕES OBRIGATÓRIAS:
1. Use a ferramenta de busca web para pesquisar a legislação real de cada feriado
2. Para feriados MUNICIPAIS: busque no site da prefeitura de ${cidade} ou na câmara municipal
3. Para feriados ESTADUAIS de ${estado}: busque no site do governo estadual ou assembleia legislativa  
4. Para feriados FEDERAIS: busque na legislação federal (planalto.gov.br)
5. Inclua OBRIGATORIAMENTE o número e ano da lei que institui cada feriado
6. Se não encontrar a lei de um feriado municipal, NÃO o inclua — é melhor omitir do que inventar
7. NÃO inclua pontos facultativos (carnaval, véspera de natal, etc)
8. Para feriados móveis (Páscoa, Corpus Christi, etc), calcule a data correta para CADA ano

Responda APENAS com JSON válido, sem texto antes ou depois, sem markdown. Formato exato:
{
  "cidade": "${cidade}",
  "estado": "${estado}",
  "feriados": [
    {
      "data": "YYYY-MM-DD",
      "nome": "Nome oficial do feriado",
      "tipo": "federal",
      "lei": "Lei nº 9.093/1995",
      "descricao": "Breve descrição ou ementa da lei"
    }
  ]
}

Tipos válidos: "federal", "estadual", "municipal"
Ordene os feriados por data.`;

  try {
    const response = await callAnthropic({
      model: "claude-sonnet-4-5",
      max_tokens: 8000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: prompt }],
    });

    // Extrai o texto da resposta (pode ter múltiplos blocos por causa do tool use)
    let textoFinal = "";
    if (response.content) {
      for (const block of response.content) {
        if (block.type === "text") {
          textoFinal = block.text;
        }
      }
    }

    if (!textoFinal) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Sem resposta de texto da API" }),
      };
    }

    // Limpa markdown se houver
    const clean = textoFinal.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let resultado;
    try {
      resultado = JSON.parse(clean);
    } catch {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Resposta da IA não é JSON válido", raw: clean.substring(0, 500) }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(resultado),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
