-- =====================================================================
-- ZapCRM — Blacklist (Lista de Exclusão de Telefones)
-- =====================================================================
-- Objetivo: garantir que números pessoais (família/amigos) NUNCA sejam
-- enriquecidos por IA nem entrem em sequências automáticas.
--
-- Arquitetura:
--   - aespacrm.crm_ignored_phones → fonte ÚNICA da verdade
--   - aespacrm.crm_contacts.is_ignored → flag derivada, mantida por triggers
--
-- IMPORTANTE: rodar no schema `aespacrm` do Supabase auto-hospedado.
-- =====================================================================

SET search_path TO aespacrm, public;

-- 1) Coluna derivada em crm_contacts -----------------------------------
ALTER TABLE aespacrm.crm_contacts
  ADD COLUMN IF NOT EXISTS is_ignored boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS crm_contacts_is_ignored_idx
  ON aespacrm.crm_contacts (user_id, is_ignored);

-- 2) Tabela fonte da verdade -------------------------------------------
CREATE TABLE IF NOT EXISTS aespacrm.crm_ignored_phones (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_norm  text NOT NULL,           -- só dígitos, normalizado
  reason      text,                    -- nota opcional (ex.: "família")
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, phone_norm),
  CHECK (phone_norm ~ '^[0-9]{6,20}$')
);

CREATE INDEX IF NOT EXISTS crm_ignored_phones_user_idx
  ON aespacrm.crm_ignored_phones (user_id);

-- 3) RLS ---------------------------------------------------------------
ALTER TABLE aespacrm.crm_ignored_phones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_select_ignored" ON aespacrm.crm_ignored_phones;
DROP POLICY IF EXISTS "owner_insert_ignored" ON aespacrm.crm_ignored_phones;
DROP POLICY IF EXISTS "owner_delete_ignored" ON aespacrm.crm_ignored_phones;
DROP POLICY IF EXISTS "owner_update_ignored" ON aespacrm.crm_ignored_phones;

CREATE POLICY "owner_select_ignored" ON aespacrm.crm_ignored_phones
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "owner_insert_ignored" ON aespacrm.crm_ignored_phones
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "owner_update_ignored" ON aespacrm.crm_ignored_phones
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "owner_delete_ignored" ON aespacrm.crm_ignored_phones
  FOR DELETE USING (auth.uid() = user_id);

-- 4) Helper: normalização de telefone ----------------------------------
CREATE OR REPLACE FUNCTION aespacrm.normalize_phone(p text)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(coalesce(p,''), '\D', '', 'g')
$$;

-- 5) Trigger: quando entra/sai da blacklist, sincroniza crm_contacts ---
CREATE OR REPLACE FUNCTION aespacrm.sync_contacts_on_blacklist_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = aespacrm, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE aespacrm.crm_contacts
       SET is_ignored = true
     WHERE user_id = NEW.user_id
       AND aespacrm.normalize_phone(phone) = NEW.phone_norm;
    -- Pausa sequências ativas desse contato (revertível ao sair da blacklist)
    UPDATE aespacrm.crm_contact_sequences cs
       SET status = 'paused',
           paused_at = now(),
           pause_reason = 'blacklisted'
      FROM aespacrm.crm_contacts c
     WHERE cs.contact_id = c.id
       AND cs.status = 'active'
       AND c.user_id = NEW.user_id
       AND aespacrm.normalize_phone(c.phone) = NEW.phone_norm;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    -- Só desmarca se NÃO houver outra entrada blacklist com mesmo phone_norm
    UPDATE aespacrm.crm_contacts
       SET is_ignored = false
     WHERE user_id = OLD.user_id
       AND aespacrm.normalize_phone(phone) = OLD.phone_norm
       AND NOT EXISTS (
         SELECT 1 FROM aespacrm.crm_ignored_phones b
          WHERE b.user_id = OLD.user_id AND b.phone_norm = OLD.phone_norm
       );
    -- Retoma sequências pausadas por blacklist
    UPDATE aespacrm.crm_contact_sequences cs
       SET status = 'active',
           paused_at = null,
           pause_reason = null,
           next_send_at = now()
      FROM aespacrm.crm_contacts c
     WHERE cs.contact_id = c.id
       AND cs.status = 'paused'
       AND cs.pause_reason = 'blacklisted'
       AND c.user_id = OLD.user_id
       AND aespacrm.normalize_phone(c.phone) = OLD.phone_norm
       AND NOT EXISTS (
         SELECT 1 FROM aespacrm.crm_ignored_phones b
          WHERE b.user_id = OLD.user_id AND b.phone_norm = OLD.phone_norm
       );
    RETURN OLD;
  END IF;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS trg_blacklist_sync ON aespacrm.crm_ignored_phones;
CREATE TRIGGER trg_blacklist_sync
AFTER INSERT OR DELETE ON aespacrm.crm_ignored_phones
FOR EACH ROW EXECUTE FUNCTION aespacrm.sync_contacts_on_blacklist_change();

-- 6) Trigger: contato novo/editado → checa blacklist -------------------
CREATE OR REPLACE FUNCTION aespacrm.set_is_ignored_on_contact()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = aespacrm, public AS $$
DECLARE
  is_blk boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM aespacrm.crm_ignored_phones
     WHERE user_id = NEW.user_id
       AND phone_norm = aespacrm.normalize_phone(NEW.phone)
  ) INTO is_blk;
  NEW.is_ignored := is_blk;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_contact_check_blacklist ON aespacrm.crm_contacts;
CREATE TRIGGER trg_contact_check_blacklist
BEFORE INSERT OR UPDATE OF phone ON aespacrm.crm_contacts
FOR EACH ROW EXECUTE FUNCTION aespacrm.set_is_ignored_on_contact();

-- 7) Backfill: marca contatos atuais que JÁ estão na blacklist ---------
UPDATE aespacrm.crm_contacts c
   SET is_ignored = true
  FROM aespacrm.crm_ignored_phones b
 WHERE c.user_id = b.user_id
   AND aespacrm.normalize_phone(c.phone) = b.phone_norm;

-- =====================================================================
-- Pronto. Rode este arquivo no SQL Editor do seu Supabase auto-hospedado.
-- =====================================================================
