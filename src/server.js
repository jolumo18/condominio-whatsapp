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
  console.error("Erro: DATABASE_URL não foi definida.");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: DATABASE_URL
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
  if (texto === "4" || texto.includes("manutenção") || texto.includes("manutencao")) return "