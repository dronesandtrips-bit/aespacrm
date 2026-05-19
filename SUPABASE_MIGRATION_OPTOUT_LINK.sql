-- Adiciona segredo HMAC por usuário para assinar tokens de descadastro.
-- Default = random base64url, evita necessidade de qualquer ação manual.
-- Aditivo: não altera nada existente.

ALTER TABLE aespacrm.crm_user_settings
  ADD COLUMN IF NOT EXISTS optout_secret text
  NOT NULL DEFAULT encode(gen_random_bytes(32), 'base64');

-- Garante que registros antigos (se houver) tenham segredo gerado.
UPDATE aespacrm.crm_user_settings
SET optout_secret = encode(gen_random_bytes(32), 'base64')
WHERE optout_secret IS NULL OR optout_secret = '';
