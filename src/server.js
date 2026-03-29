import express from "express";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const app = express();
app.use(express.json());

const {
  PORT = 3000,
  DATABASE_URL,
  WHATSAPP_VERIFY_TOKEN,
  WHATSAPP_ACCESS_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_GRAPH_VERSION = "v23.0",
  CONDOMINIO_SIGLA = "COND"
} = process.env;

const pool = new pg.Pool({
  connectionString: DATABASE_URL
});
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

function normalizarTexto(texto = "") {
  return texto.trim();
}

function extrairEntrada(message) {
  if (!message) return { tipo: "unknown", texto: "", id: "" };

  if (message.type === "text") {
    return {
      tipo: "text",
      texto: message.text?.body || "",
      id: ""
    };
  }

  if (message.type === "interactive") {
    const buttonReply = message.interactive?.button_reply;
    const listReply = message.interactive?.list_reply;

    if (buttonReply) {
      return {
        tipo: "button_reply",
        texto: buttonReply.title || "",
        id: buttonReply.id || ""
      };
    }

    if (listReply) {
      return {
        tipo: "list_reply",
        texto: listReply.title || "",
        id: listReply.id || ""
      };
    }
  }

  return {
    tipo: message.type || "unknown",
    texto: "",
    id: ""
  };
}

function parseBlocoUnidade(texto) {
  const valor = normalizarTexto(texto);
  const regex = /(?:bloco\\s*)?([A-Za-z0-9]+)[,\\s\\-\\/]+(?:apto|apartamento|apt|unidade|un)\\s*([A-Za-z0-9\\-]+)/i;
  const simples = /^([A-Za-z0-9]+)\\s+([A-Za-z0-9\\-]+)$/i;

  let match = valor.match(regex);
  if (match) {
    return {
      bloco: match[1].toUpperCase(),
      unidade: match[2].toUpperCase()
    };
  }

  match = valor.match(simples);
  if (match) {
    return {
      bloco: match[1].toUpperCase(),
      unidade: match[2].toUpperCase()
    };
  }

  return null;
}

async function enviarRequestWhatsApp(payload) {
  const url = `https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Erro WhatsApp: ${JSON.stringify(data)}`);
  }

  return data;
}

async function enviarTexto(to, body) {
  return enviarRequestWhatsApp({
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body }
  });
}

async function enviarListaCategorias(to) {
  return enviarRequestWhatsApp({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      header: {
        type: "text",
        text: "Nova reclamação"
      },
      body: {
        text: "Selecione o tipo da reclamação:"
      },
      footer: {
        text: "Escolha uma opção"
      },
      action: {
        button: "Ver categorias",
        sections: [
          {
            title: "Categorias",
            rows: [
              { id: "CAT_BARULHO", title: "Barulho", description: "Som alto, festa, perturbação" },
              { id: "CAT_LIMPEZA", title: "Limpeza", description: "Sujeira, lixo, áreas comuns" },
              { id: "CAT_SEGURANCA", title: "Segurança", description: "Acesso, portaria, risco" },
              { id: "CAT_MANUTENCAO", title: "Manutenção", description: "Vazamento, iluminação, defeito" },
              { id: "CAT_OUTRO", title: "Outro", description: "Outras ocorrências" }
            ]
          }
        ]
      }
    }
  });
}

async function enviarConfirmacao(to, resumo) {
  return enviarRequestWhatsApp({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text: resumo
      },
      footer: {
        text: "Confirme para abrir o protocolo"
      },
      action: {
        buttons: [
          {
            type: "reply",
            reply: {
              id: "CONFIRMAR_RECLAMACAO",
              title: "Confirmar"
            }
          },
          {
            type: "reply",
            reply: {
              id: "CANCELAR_RECLAMACAO",
              title: "Cancelar"
            }
          }
        ]
      }
    }
  });
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
  const existente = await buscarSessao(telefone);

  if (existente) {
    const { rows } = await pool.query(
      `
      UPDATE atendimentos_whatsapp
      SET
        nome_contato = $2,
        etapa = 'aguardando_categoria',
        categoria = NULL,
        bloco = NULL,
        unidade = NULL,
        descricao = NULL,
        ativo = TRUE
      WHERE telefone = $1
      RETURNING *
      `,
      [telefone, nomeContato]
    );

    return rows[0];
  }

  const { rows } = await pool.query(
    `
    INSERT INTO atendimentos_whatsapp
      (telefone, nome_contato, etapa, ativo)
    VALUES
      ($1, $2, 'aguardando_categoria', TRUE)
    RETURNING *
    `,
    [telefone, nomeContato]
  );

  return rows[0];
}

async function atualizarSessao(telefone, campos) {
  const sets = [];
  const values = [];
  let index = 1;

  for (const [chave, valor] of Object.entries(campos)) {
    sets.push(`${chave} = $${index}`);
    values.push(valor);
    index++;
  }

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
    SET ativo = FALSE, etapa = 'encerrado'
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
      (protocolo, telefone, nome_contato, categoria, bloco, unidade, descricao, status)
    VALUES
      ($1, $2, $3, $4, $5, $6, $7, 'aberto')
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

function nomeCategoriaPorId(id) {
  const mapa = {
    CAT_BARULHO: "Barulho",
    CAT_LIMPEZA: "Limpeza",
    CAT_SEGURANCA: "Segurança",
    CAT_MANUTENCAO: "Manutenção",
    CAT_OUTRO: "Outro"
  };

  return mapa[id] || null;
}

function montarResumo(sessao) {
  return (
    `Confira os dados da sua reclamação:\\n\\n` +
    `Categoria: ${sessao.categoria}\\n` +
    `Bloco: ${sessao.bloco}\\n` +
    `Unidade: ${sessao.unidade}\\n` +
    `Descrição: ${sessao.descricao}\\n\\n` +
    `Deseja confirmar a abertura do protocolo?`
  );
}

async function processarMensagem({ telefone, nomeContato, entrada }) {
  let sessao = await buscarSessao(telefone);

  const texto = normalizarTexto(entrada.texto).toLowerCase();
  if (["menu", "iniciar", "nova reclamação", "reclamação", "oi", "olá", "ola"].includes(texto)) {
    await criarOuResetarSessao({ telefone, nomeContato });
    await enviarListaCategorias(telefone);
    return;
  }

  if (!sessao) {
    await criarOuResetarSessao({ telefone, nomeContato });
    await enviarTexto(
      telefone,
      `Olá${nomeContato ? `, ${nomeContato}` : ""}. Vamos registrar sua reclamação.`
    );
    await enviarListaCategorias(telefone);
    return;
  }

  if (sessao.etapa === "aguardando_categoria") {
    const categoria = nomeCategoriaPorId(entrada.id);

    if (!categoria) {
      await enviarTexto(
        telefone,
        "Selecione uma categoria pela lista para continuarmos."
      );
      await enviarListaCategorias(telefone);
      return;
    }

    await atualizarSessao(telefone, {
      categoria,
      etapa: "aguardando_bloco_unidade"
    });

    await enviarTexto(
      telefone,
      `Categoria selecionada: ${categoria}.\\nAgora informe bloco e unidade.\\nExemplo: Bloco B, apto 204`
    );
    return;
  }

  if (sessao.etapa === "aguardando_bloco_unidade") {
    const dados = parseBlocoUnidade(entrada.texto);

    if (!dados) {
      await enviarTexto(
        telefone,
        "Não entendi o bloco/unidade.\\nEnvie no formato: Bloco B, apto 204"
      );
      return;
    }

    await atualizarSessao(telefone, {
      bloco: dados.bloco,
      unidade: dados.unidade,
      etapa: "aguardando_descricao"
    });

    await enviarTexto(
      telefone,
      "Perfeito. Agora descreva o ocorrido com o máximo de detalhes possível."
    );
    return;
  }

  if (sessao.etapa === "aguardando_descricao") {
    const descricao = normalizarTexto(entrada.texto);

    if (!descricao || descricao.length < 5) {
      await enviarTexto(
        telefone,
        "Envie uma descrição um pouco mais completa para registrar a reclamação."
      );
      return;
    }

    const atualizada = await atualizarSessao(telefone, {
      descricao,
      etapa: "aguardando_confirmacao"
    });

    await enviarConfirmacao(telefone, montarResumo(atualizada));
    return;
  }

  if (sessao.etapa === "aguardando_confirmacao") {
    if (entrada.id === "CANCELAR_RECLAMACAO") {
      await encerrarSessao(telefone);
      await enviarTexto(
        telefone,
        "Solicitação cancelada. Quando quiser abrir uma nova reclamação, envie: menu"
      );
      return;
    }

    if (entrada.id === "CONFIRMAR_RECLAMACAO") {
      const sessaoFinal = await buscarSessao(telefone);
      const reclamacao = await criarReclamacao(sessaoFinal);
      await encerrarSessao(telefone);

      await enviarTexto(
        telefone,
        `Recebemos sua reclamação com sucesso.\\n` +
          `Protocolo: ${reclamacao.protocolo}\\n` +
          `Status: Aberto\\n` +
          `Nossa equipe irá analisar a solicitação.\\n` +
          `Por favor, aguarde a resposta.`
      );
      return;
    }

    const sessaoAtual = await buscarSessao(telefone);
    await enviarTexto(
      telefone,
      "Use os botões para confirmar ou cancelar a abertura do protocolo."
    );
    await enviarConfirmacao(telefone, montarResumo(sessaoAtual));
  }
}

app.get("/", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    if (!value) return res.sendStatus(200);
    if (value.statuses) return res.sendStatus(200);

    const contato = value.contacts?.[0];
    const message = value.messages?.[0];

    if (!message) return res.sendStatus(200);

    const telefone = message.from;
    const nomeContato = contato?.profile?.name || null;
    const entrada = extrairEntrada(message);

    if (!telefone) return res.sendStatus(200);

    await processarMensagem({
      telefone,
      nomeContato,
      entrada
    });

    return res.sendStatus(200);
  } catch (err) {
    console.error("Erro no webhook:", err);
    return res.sendStatus(500);
  }
});

app.get("/reclamacoes", async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT *
      FROM reclamacoes
      ORDER BY criado_em DESC
      LIMIT 100
    `);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
  });inicializarBanco()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Servidor rodando na porta ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Erro ao inicializar banco:", err);
  });