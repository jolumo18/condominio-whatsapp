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

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.atualizado_em = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_atendimentos_updated_at ON atendimentos_whatsapp;
CREATE TRIGGER trg_atendimentos_updated_at
BEFORE UPDATE ON atendimentos_whatsapp
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_reclamacoes_updated_at ON reclamacoes;
CREATE TRIGGER trg_reclamacoes_updated_at
BEFORE UPDATE ON reclamacoes
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();