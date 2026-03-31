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
  CONDOMINIO_SIGLA = "COND"
} = process.env;

if (!DATABASE_URL) {
  console.error("Erro: DATABASE_URL não foi definida no .env ou no Render.");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: DATABASE_URL
});

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

  return rows[0];
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
      return (
        "Não entendi a categoria.\n\n" +
        menuCategorias()
      );
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
        return (
          "Houve um problema ao concluir o atendimento.\n" +
          "Vamos recomeçar.\n\n" +
          menuCategorias()
        );
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

    return (
      montarResumo(sessao) +
      "\n\nDigite apenas CONFIRMAR ou CANCELAR."
    );
  }

  await criarOuResetarSessao({ telefone, nomeContato });
  return menuCategorias();
}

// Healthcheck
app.get("/", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.status(200).json({ ok: true, service: "condominio-whatsapp-twilio" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Lista as últimas reclamações
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

// Consulta uma reclamação por protocolo
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

// Webhook da Twilio Sandbox
const STATUS_PERMITIDOS = [
  "aberto",
  "em_analise",
  "respondido",
  "finalizado"
];

app.post("/reclamacoes/:protocolo/status", async (req, res) => {
  try {
    const { protocolo } = req.params;
    const status = normalizarTexto(req.body.status || "").toLowerCase();

    if (!STATUS_PERMITIDOS.includes(status)) {
      return res.status(400).json({
        error: "Status inválido",
        permitidos: STATUS_PERMITIDOS
      });
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
      return res.status(404).json({
        error: "Protocolo não encontrado"
      });
    }

    res.json({
      ok: true,
      mensagem: "Status atualizado com sucesso",
      reclamacao: rows[0]
    });
  } catch (err) {
    console.error("Erro ao atualizar status:", err);
    res.status(500).json({
      error: "Erro interno ao atualizar status"
    });
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