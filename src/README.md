Sistema de Reclamações via WhatsApp + Painel Web

📌 Descrição

Sistema completo para registro e acompanhamento de reclamações de condomínio via WhatsApp, com painel web administrativo para gestão, análise e relatórios.

---

🚀 Funcionalidades

📱 WhatsApp (Twilio)

- Registro de reclamações por conversa guiada
- Geração automática de protocolo
- Consulta de status via comando:
  status SEU_PROTOCOLO

---

🖥️ Painel Web

- Visualização de reclamações
- Filtros por:
  - protocolo
  - telefone
  - nome
  - categoria
  - status
  - período
- Paginação
- Atualização de status com observação
- Histórico completo de cada reclamação
- Visualização detalhada
- Impressão (PDF)

---

📊 Relatórios e Análises

- Gráfico por status

- Gráfico por categoria

- Gráfico por dia

- Gráfico por bloco

- Gráfico por unidade

- Top 5:
  
  - blocos
  - unidades
  - telefones
  - moradores

- Ranking de categorias

- Média de reclamações por dia

- Média por categoria

- Tempo médio até atualização

---

📁 Exportação

- Exportação para CSV com filtros aplicados

---

⚙️ Tecnologias

- Node.js
- Express
- PostgreSQL
- Twilio (WhatsApp API)

---

📦 Instalação

1. Clonar o projeto

git clone SEU_REPOSITORIO
cd SEU_PROJETO

2. Instalar dependências

npm install

3. Criar arquivo ".env"

PORT=3000

DATABASE_URL=postgres://usuario:senha@host:porta/banco

CONDOMINIO_SIGLA=COND

PAINEL_USER=admin
PAINEL_PASS=senha

TWILIO_ACCOUNT_SID=xxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxx
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886

---

▶️ Executar o projeto

npm start

Servidor rodará em:

http://localhost:3000

---

🔗 Rotas principais

Sistema

- "/" → status do servidor

WhatsApp

- "/twilio-webhook" → webhook Twilio

Painel

- "/painel" → painel administrativo (com login)

API

- "/reclamacoes" → lista em JSON
- "/reclamacoes/:protocolo" → detalhe JSON

Relatórios

- "/exportar-csv" → exportação

Visualização

- "/reclamacoes/:protocolo/detalhes"
- "/reclamacoes/:protocolo/historico"

---

🔐 Autenticação do painel

O painel usa autenticação básica (Basic Auth):

- Usuário: definido em "PAINEL_USER"
- Senha: definida em "PAINEL_PASS"

---

🧪 Fluxo do usuário (WhatsApp)

1. Usuário envia "oi"
2. Escolhe categoria
3. Informa bloco/unidade
4. Descreve problema
5. Confirma
6. Recebe protocolo

---

🧪 Fluxo do administrador

1. Acessa "/painel"
2. Filtra reclamações
3. Analisa dados e gráficos
4. Atualiza status
5. Acompanha histórico

---

📌 Observações

- O sistema cria automaticamente as tabelas no banco
- O envio de WhatsApp depende de credenciais válidas da Twilio
- O painel é protegido por autenticação

---

📄 Licença

Projeto para uso interno / educacional / corporativo.

---

👨‍💻 Autor

Desenvolvido por você 🚀