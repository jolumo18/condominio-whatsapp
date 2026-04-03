import express from "express";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const {
  PORT = 3000,
  DATABASE_URL,
  CONDOMINIO_SIGLA = "COND",
  PAINEL_USER,
  PAINEL_PASS,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_WHATSAPP_FROM
} = process.env;

if (!DATABASE_URL) {
  console.error("Erro: DATABASE_URL não foi definida.");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

const STATUS_PERMITIDOS = [
  "aberto",
  "em_analise",
  "respondido",
  "finalizado"
];

function normalizarTexto(texto = "") {
  return String(texto).trim();
}

function limparTelefoneTwilio(from = "") {
  return String(from)
    .replace(/^whatsapp:/i, "")
    .replace(/[^\d+]/g, "")
    .replace(/^\+/, "");
}

function escapeXml(valor = "") {
  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeHtml(valor = "") {
  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function responderTwilio(texto) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${escapeXml(texto)}</Message>
</Response>`;
}

function gerarProtocolo(sigla = "COND") {
  const agora = new Date();
  const y = agora.getFullYear();
  const m = String(agora.getMonth() + 1).padStart(2, "0");
  const d = String(agora.getDate()).padStart(2, "0");
  const h = String(agora.getHours()).padStart(2, "0");
  const min = String(agora.getMinutes()).padStart(2, "0");
  const s = String(agora.getSeconds()).padStart(2, "0");
  const rand = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
  return `${sigla}-${y}${m}${d}-${h}${min}${s}-${rand}`;
}

function menuCategorias() {
  return (
    "Vamos registrar sua reclamação.\n\n" +
    "Informe o número da categoria:\n" +
    "1 - Barulho\n" +
    "2 - Limpeza\n" +
    "3 - Segurança\n" +
    "4 - Manutenção\n" +
    "5 - Outro"
  );
}

function identificarCategoria(entrada = "") {
  const texto = normalizarTexto(entrada).toLowerCase();

  if (texto === "1" || texto.includes("barulho")) return "Barulho";
  if (texto === "2" || texto.includes("limpeza")) return "Limpeza";
  if (texto === "3" || texto.includes("segurança") || texto.includes("seguranca")) return "Segurança";
  if (texto === "4" || texto.includes("manutenção") || texto.includes("manutencao")) return "Manutenção";
  if (texto === "5" || texto.includes("outro")) return "Outro";

  return null;
}

function parseBlocoUnidade(texto = "") {
  const valor = normalizarTexto(texto);

  const regex1 = /(?:bloco\s*)?([A-Za-z0-9]+)[,\s\-\/]+(?:apto|apartamento|apt|unidade|un)\s*([A-Za-z0-9\-]+)/i;
  const regex2 = /^([A-Za-z0-9]+)\s+([A-Za-z0-9\-]+)$/i;
  const regex3 = /bloco\s*([A-Za-z0-9]+).*?(?:apto|apartamento|apt|unidade|un)\s*([A-Za-z0-9\-]+)/i;

  let match = valor.match(regex1);
  if (match) {
    return {
      bloco: match[1].toUpperCase(),
      unidade: match[2].toUpperCase()
    };
  }

  match = valor.match(regex3);
  if (match) {
    return {
      bloco: match[1].toUpperCase(),
      unidade: match[2].toUpperCase()
    };
  }

  match = valor.match(regex2);
  if (match) {
    return {
      bloco: match[1].toUpperCase(),
      unidade: match[2].toUpperCase()
    };
  }

  return null;
}

function montarResumo(sessao) {
  return (
    "Confira os dados da sua reclamação:\n\n" +
    `Categoria: ${sessao.categoria}\n` +
    `Bloco: ${sessao.bloco}\n` +
    `Unidade: ${sessao.unidade}\n` +
    `Descrição: ${sessao.descricao}\n\n` +
    "Responda CONFIRMAR para abrir o protocolo.\n" +
    "Responda CANCELAR para desistir."
  );
}

function renderizarPainelHtml(reclamacoes, filtroProtocolo = "") {
  const linhas = reclamacoes.map((r) => {
    const protocolo = escapeHtml(r.protocolo || "-");
    const nomeContato = escapeHtml(r.nome_contato || "-");
    const telefone = escapeHtml(r.telefone || "-");
    const categoria = escapeHtml(r.categoria || "-");
    const bloco = escapeHtml(r.bloco || "-");
    const unidade = escapeHtml(r.unidade || "-");
    const descricao = escapeHtml(r.descricao || "-");
    const status = escapeHtml(r.status || "-");
    const criadoEm = new Date(r.criado_em).toLocaleString("pt-BR");

    return `
      <tr>
        <td>${protocolo}</td>
        <td>${nomeContato}</td>
        <td>${telefone}</td>
        <td>${categoria}</td>
        <td>${bloco}</td>
        <td>${unidade}</td>
        <td style="max-width: 320px; white-space: pre-wrap;">${descricao}</td>
        <td><strong>${status}</strong></td>
        <td>${criadoEm}</td>
<td>
  <a href="/reclamacoes/${protocolo}/historico" target="_blank">Ver histórico</a>
</td>
<td>
  <form method="POST" action="/painel/status" style="display:flex; flex-direction:column; gap:8px;">
            <input type="hidden" name="protocolo" value="${protocolo}" />
            <select name="status" required>
              <option value="aberto" ${r.status === "aberto" ? "selected" : ""}>aberto</option>
              <option value="em_analise" ${r.status === "em_analise" ? "selected" : ""}>em_analise</option>
              <option value="respondido" ${r.status === "respondido" ? "selected" : ""}>respondido</option>
              <option value="finalizado" ${r.status === "finalizado" ? "selected" : ""}>finalizado</option>
            </select>
            <button type="submit">Atualizar</button>
          </form>
        </td>
      </tr>
    `;
  }).join("");

  return `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Painel de Reclamações</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          margin: 24px;
          background: #f7f7f7;
          color: #222;
        }
        h1 {
          margin-bottom: 8px;
        }
        .box {
          background: white;
          border-radius: 10px;
          padding: 16px;
          margin-bottom: 20px;
          box-shadow: 0 1px 6px rgba(0,0,0,0.08);
        }
        form.busca {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        input, select, button {
          padding: 10px;
          border-radius: 8px;
          border: 1px solid #ccc;
          font-size: 14px;
        }
        button {
          cursor: pointer;
          background: #222;
          color: white;
          border: none;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          background: white;
        }
        th, td {
          border: 1px solid #ddd;
          padding: 10px;
          vertical-align: top;
          text-align: left;
          font-size: 14px;
        }
        th {
          background: #f0f0f0;
        }
        .topo {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }
      </style>
    </head>
    <body>
      <div class="topo">
        <div>
          <h1>Painel de Reclamações</h1>
          <p>Use este painel para consultar protocolos e atualizar status.</p>
        </div>
        <div>
          <a href="/reclamacoes" target="_blank">Ver JSON</a>
        </div>
      </div>

      <div class="box">
        <form class="busca" method="GET" action="/painel">
          <input
            type="text"
            name="protocolo"
            placeholder="Buscar por protocolo"
            value="${escapeHtml(filtroProtocolo)}"
            style="min-width: 280px;"
          />
          <button type="submit">Buscar</button>
        </form>
      </div>

      <div class="box">
        <table>
          <thead>
            <tr>
              <th>Protocolo</th>
              <th>Nome</th>
              <th>Telefone</th>
              <th>Categoria</th>
              <th>Bloco</th>
              <th>Unidade</th>
              <th>Descrição</th>
              <th>Status</th>
              <th>Criado em</th>
              <th>Histórico</th>
              <th>Ação</th>
            </tr>
          </thead>
          <tbody>
            ${linhas || `<tr><td colspan="10">Nenhuma reclamação encontrada.</td></tr>`}
          </tbody>
        </table>
      </div>
    </body>
    </html>
  `;
}

function middlewareProtegePainel(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!PAINEL_USER || !PAINEL_PASS) {
    return res.status(500).send("Usuário e senha do painel não configurados.");
  }

  if (!authHeader || !authHeader.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Painel Restrito"');
    return res.status(401).send("Autenticação necessária.");
  }

  const base64 = authHeader.split(" ")[1];
  const credenciais = Buffer.from(base64, "base64").toString("utf-8");
  const [usuario, senha] = credenciais.split(":");

  if (usuario !== PAINEL_USER || senha !== PAINEL_PASS) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Painel Restrito"');
    return res.status(401).send("Usuário ou senha inválidos.");
  }

  next();
}

function formatarTelefoneTwilioParaEnvio(telefone = "") {
  const limpo = String(telefone).replace(/[^\d]/g, "");
  return `whatsapp:+${limpo}`;
}

async function enviarMensagemStatusWhatsApp(reclamacao) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_FROM) {
    throw new Error("Credenciais Twilio não configuradas.");
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;

  const mensagem =
    `Atualização da sua reclamação.\n` +
    `Protocolo: ${reclamacao.protocolo}\n` +
    `Novo status: ${reclamacao.status}\n` +
    `Categoria: ${reclamacao.categoria}\n` +
    `Bloco: ${reclamacao.bloco || "-"}\n` +
    `Unidade: ${reclamacao.unidade || "-"}`;

  const body = new URLSearchParams({
    From: TWILIO_WHATSAPP_FROM,
    To: formatarTelefoneTwilioParaEnvio(reclamacao.telefone),
    Body: mensagem
  });

  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!response.ok) {
    const erro = await response.text();
    throw new Error(`Erro ao enviar WhatsApp: ${erro}`);
  }

  return response.json();
}

async function inicializarBanco() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS atendimentos_whatsapp (
      id BIGSERIAL PRIMARY KEY,
      telefone VARCHAR(30) NOT NULL UNIQUE,
      nome_contato VARCHAR(120),
      etapa VARCHAR(40) NOT NULL DEFAULT 'inicio',
      categoria VARCHAR(60),
      bloco VARCHAR(20),
      unidade VARCHAR(20),
      descricao TEXT,
      ativo BOOLEAN NOT NULL DEFAULT TRUE,
      criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reclamacoes (
      id BIGSERIAL PRIMARY KEY,
      protocolo VARCHAR(40) NOT NULL UNIQUE,
      telefone VARCHAR(30) NOT NULL,
      nome_contato VARCHAR(120),
      categoria VARCHAR(60) NOT NULL,
      bloco VARCHAR(20),
      unidade VARCHAR(20),
      descricao TEXT NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'aberto',
      criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reclamacoes_historico (
      id BIGSERIAL PRIMARY KEY,
      protocolo VARCHAR(40) NOT NULL,
      status VARCHAR(30) NOT NULL,
      observacao TEXT,
      criado_em TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `); 
await pool.query(`
    CREATE TABLE IF NOT EXISTS reclamacoes_historico (
      id BIGSERIAL PRIMARY KEY,
      protocolo VARCHAR(40) NOT NULL,
      status VARCHAR(30) NOT NULL,
      observacao TEXT,
      criado_em TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  console.log("Banco inicializado com sucesso.");
}

async function buscarSessao(telefone) {
  const { rows } = await pool.query(
    `
    SELECT *
    FROM atendimentos_whatsapp
    WHERE telefone = $1 AND ativo = TRUE
    LIMIT 1
    `,
    [telefone]
  );

  return rows[0] || null;
}

async function criarOuResetarSessao({ telefone, nomeContato }) {
  const { rows } = await pool.query(
    `
    INSERT INTO atendimentos_whatsapp
      (telefone, nome_contato, etapa, categoria, bloco, unidade, descricao, ativo, atualizado_em)
    VALUES
      ($1, $2, 'aguardando_categoria', NULL, NULL, NULL, NULL, TRUE, NOW())
    ON CONFLICT (telefone)
    DO UPDATE SET
      nome_contato = EXCLUDED.nome_contato,
      etapa = 'aguardando_categoria',
      categoria = NULL,
      bloco = NULL,
      unidade = NULL,
      descricao = NULL,
      ativo = TRUE,
      atualizado_em = NOW()
    RETURNING *
    `,
    [telefone, nomeContato]
  );

  return rows[0];
}

async function atualizarSessao(telefone, campos) {
  const chaves = Object.keys(campos);

  if (!chaves.length) {
    return buscarSessao(telefone);
  }

  const sets = [];
  const values = [];
  let index = 1;

  for (const chave of chaves) {
    sets.push(`${chave} = $${index}`);
    values.push(campos[chave]);
    index++;
  }

  sets.push(`atualizado_em = NOW()`);
  values.push(telefone);

  const query = `
    UPDATE atendimentos_whatsapp
    SET ${sets.join(", ")}
    WHERE telefone = $${index}
    RETURNING *
  `;

  const { rows } = await pool.query(query, values);
  return rows[0] || null;
}

async function encerrarSessao(telefone) {
  await pool.query(
    `
    UPDATE atendimentos_whatsapp
    SET ativo = FALSE, etapa = 'encerrado', atualizado_em = NOW()
    WHERE telefone = $1
    `,
    [telefone]
  );
}

async function criarReclamacao(sessao) {
  const protocolo = gerarProtocolo(CONDOMINIO_SIGLA);

  const { rows } = await pool.query(
    `
    INSERT INTO reclamacoes
      (protocolo, telefone, nome_contato, categoria, bloco, unidade, descricao, status, atualizado_em)
    VALUES
      ($1, $2, $3, $4, $5, $6, $7, 'aberto', NOW())
    RETURNING *
    `,
    [
      protocolo,
      sessao.telefone,
      sessao.nome_contato,
      sessao.categoria,
      sessao.bloco,
      sessao.unidade,
      sessao.descricao
    ]
  );

  const reclamacao = rows[0];

  await pool.query(
    `
    INSERT INTO reclamacoes_historico (protocolo, status, observacao)
    VALUES ($1, $2, $3)
    `,
    [reclamacao.protocolo, reclamacao.status, "Reclamação criada pelo WhatsApp"]
  );

  return reclamacao;
}

async function buscarReclamacaoPorProtocolo(protocolo) {
  const { rows } = await pool.query(
    `
    SELECT *
    FROM reclamacoes
    WHERE protocolo = $1
    LIMIT 1
    `,
    [protocolo]
  );

  return rows[0] || null;
}

async function processarMensagemTwilio({ telefone, nomeContato, mensagem }) {
  const textoOriginal = normalizarTexto(mensagem);
  const texto = textoOriginal.toLowerCase();

  if (!telefone) {
    return "Não consegui identificar seu número. Tente novamente.";
  }

  if (texto.startsWith("status ")) {
    const protocolo = textoOriginal.replace(/^status\s+/i, "").trim();
    const reclamacao = await buscarReclamacaoPorProtocolo(protocolo);

    if (!reclamacao) {
      return "Não encontrei esse protocolo. Verifique e tente novamente.";
    }

    return (
      `Protocolo: ${reclamacao.protocolo}\n` +
      `Status: ${reclamacao.status}\n` +
      `Categoria: ${reclamacao.categoria}\n` +
      `Bloco: ${reclamacao.bloco || "-"}\n` +
      `Unidade: ${reclamacao.unidade || "-"}`
    );
  }

  if (
    ["menu", "iniciar", "oi", "olá", "ola", "reclamação", "reclamacao", "nova reclamação", "nova reclamacao"].includes(texto)
  ) {
    await criarOuResetarSessao({ telefone, nomeContato });
    return menuCategorias();
  }

  let sessao = await buscarSessao(telefone);

  if (!sessao) {
    await criarOuResetarSessao({ telefone, nomeContato });
    return menuCategorias();
  }

  if (sessao.etapa === "aguardando_categoria") {
    const categoria = identificarCategoria(textoOriginal);

    if (!categoria) {
      return "Não entendi a categoria.\n\n" + menuCategorias();
    }

    await atualizarSessao(telefone, {
      categoria,
      etapa: "aguardando_bloco_unidade"
    });

    return (
      `Categoria selecionada: ${categoria}\n\n` +
      "Agora informe bloco e unidade.\n" +
      "Exemplo: Bloco B, apto 204"
    );
  }

if (sessao.etapa === "aguardando_bloco_unidade") {
  const dados = parseBlocoUnidade(textoOriginal);

  if (!dados) {
    return (
      "Não entendi bloco e unidade.\n" +
      "Envie no formato:\n" +
      "Bloco B, apto 204"
    );
  }

  await atualizarSessao(telefone, {
    bloco: dados.bloco,
    unidade: dados.unidade,
    etapa: "aguardando_descricao"
  });

  return "Perfeito. Agora descreva o ocorrido com o máximo de detalhes possível.";
}

  if (sessao.etapa === "aguardando_descricao") {
    if (!textoOriginal || textoOriginal.length < 5) {
      return "Envie uma descrição um pouco mais completa para registrar a reclamação.";
    }

    sessao = await atualizarSessao(telefone, {
      descricao: textoOriginal,
      etapa: "aguardando_confirmacao"
    });

    return montarResumo(sessao);
  }

  if (sessao.etapa === "aguardando_confirmacao") {
    if (["cancelar", "cancela", "nao", "não", "2"].includes(texto)) {
      await encerrarSessao(telefone);
      return "Solicitação cancelada. Quando quiser começar de novo, envie: menu";
    }

    if (["confirmar", "confirmo", "sim", "1"].includes(texto)) {
      const sessaoFinal = await buscarSessao(telefone);

      if (!sessaoFinal || !sessaoFinal.categoria || !sessaoFinal.bloco || !sessaoFinal.unidade || !sessaoFinal.descricao) {
        await criarOuResetarSessao({ telefone, nomeContato });
        return "Houve um problema ao concluir o atendimento.\nVamos recomeçar.\n\n" + menuCategorias();
      }

      const reclamacao = await criarReclamacao(sessaoFinal);
      await encerrarSessao(telefone);

      return (
        "Recebemos sua reclamação com sucesso.\n" +
        `Protocolo: ${reclamacao.protocolo}\n` +
        "Status: aberto\n" +
        "Nossa equipe irá analisar a solicitação.\n" +
        "Por favor, aguarde a resposta."
      );
    }

    return montarResumo(sessao) + "\n\nDigite apenas CONFIRMAR ou CANCELAR.";
  }

  await criarOuResetarSessao({ telefone, nomeContato });
  return menuCategorias();
}

app.get("/", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.status(200).json({ ok: true, service: "condominio-whatsapp-twilio" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/reclamacoes", async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, protocolo, telefone, nome_contato, categoria, bloco, unidade, descricao, status, criado_em, atualizado_em
      FROM reclamacoes
      ORDER BY criado_em DESC
      LIMIT 100
    `);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/reclamacoes/:protocolo", async (req, res) => {
  try {
    const { protocolo } = req.params;
    const reclamacao = await buscarReclamacaoPorProtocolo(protocolo);

    if (!reclamacao) {
      return res.status(404).json({ error: "Protocolo não encontrado" });
    }

    res.json(reclamacao);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/painel", middlewareProtegePainel, async (req, res) => {
  try {
    const protocolo = normalizarTexto(req.query.protocolo || "");

    let query = `
      SELECT id, protocolo, telefone, nome_contato, categoria, bloco, unidade, descricao, status, criado_em, atualizado_em
      FROM reclamacoes
    `;
    const values = [];

    if (protocolo) {
      query += ` WHERE protocolo ILIKE $1 `;
      values.push(`%${protocolo}%`);
    }

    query += ` ORDER BY criado_em DESC LIMIT 100 `;

    const { rows } = await pool.query(query, values);

    res.send(renderizarPainelHtml(rows, protocolo));
  } catch (err) {
    console.error("Erro ao abrir painel:", err);
    res.status(500).send("Erro ao abrir o painel.");
  }
});

app.post("/painel/status", middlewareProtegePainel, async (req, res) => {
  try {
    const protocolo = normalizarTexto(req.body.protocolo || "");
    const status = normalizarTexto(req.body.status || "").toLowerCase();

    if (!STATUS_PERMITIDOS.includes(status)) {
      return res.status(400).send("Status inválido.");
    }

    const { rows } = await pool.query(
      `
      UPDATE reclamacoes
      SET status = $1, atualizado_em = NOW()
      WHERE protocolo = $2
      RETURNING id, protocolo, telefone, nome_contato, categoria, bloco, unidade, descricao, status, criado_em, atualizado_em
      `,
      [status, protocolo]
    );

    if (!rows.length) {
      return res.status(404).send("Protocolo não encontrado.");
    }

    const reclamacaoAtualizada = rows[0];
await pool.query(
  `
  INSERT INTO reclamacoes_historico (protocolo, status, observacao)
  VALUES ($1, $2, $3)
  `,
  [
    reclamacaoAtualizada.protocolo,
    reclamacaoAtualizada.status,
    "Status alterado pelo painel"
  ]
);
    try {
      await enviarMensagemStatusWhatsApp(reclamacaoAtualizada);
    } catch (erroEnvio) {
      console.error("Status atualizado, mas falhou o envio do WhatsApp:", erroEnvio);
    }

    res.redirect("/painel");
  } catch (err) {
    console.error("Erro ao atualizar status pelo painel:", err);
    res.status(500).send("Erro ao atualizar status.");
  }
});
app.get("/reclamacoes/:protocolo/historico", async (req, res) => {
  try {
    const { protocolo } = req.params;

    const { rows } = await pool.query(
      `
      SELECT id, protocolo, status, observacao, criado_em
      FROM reclamacoes_historico
      WHERE protocolo = $1
      ORDER BY criado_em ASC
      `,
      [protocolo]
    );

    res.json(rows);
  } catch (err) {
    console.error("Erro ao buscar histórico:", err);
    res.status(500).json({ error: "Erro ao buscar histórico." });
  }
});

app.post("/twilio-webhook", async (req, res) => {
  try {
    const telefone = limparTelefoneTwilio(req.body.From || "");
    const nomeContato = normalizarTexto(req.body.ProfileName || "");
    const mensagem = normalizarTexto(req.body.Body || "");

    const resposta = await processarMensagemTwilio({
      telefone,
      nomeContato,
      mensagem
    });

    res.type("text/xml");
    res.send(responderTwilio(resposta));
  } catch (err) {
    console.error("Erro no webhook da Twilio:", err);

    res.type("text/xml");
    res.send(
      responderTwilio(
        "Tivemos um problema interno ao processar sua mensagem. Tente novamente em instantes."
      )
    );
  }
});

inicializarBanco()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Servidor rodando na porta ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Erro ao inicializar banco:", err);
    process.exit(1);
  });