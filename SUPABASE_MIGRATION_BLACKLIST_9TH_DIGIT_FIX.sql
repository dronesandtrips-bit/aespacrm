-- =====================================================================
-- ZapCRM — Blacklist resiliente ao 9º dígito (BR)
-- =====================================================================
-- PROBLEMA:
--   crm_ignored_phones guarda o telefone EXATO (phone_norm). Quando o
--   contato passou a ser gravado na outra variante (com/sem o 9º dígito
--   — merge de duplicados / sync da Evolution), a trigger
--   set_is_ignored_on_contact não encontrava a linha da blacklist e
--   gravava is_ignored = false. Resultado: contatos "saíam" da blacklist
--   sozinhos e o Robô voltava a responder.
--
-- SOLUÇÃO (aditiva, não remove nada):
--   1) helper phone_variants() → variantes equivalentes do número
--   2) triggers passam a casar por VARIANTES, não por igualdade exata
--   3) backfill: re-marca contatos e recria sequências pausadas
-- =====================================================================

SET search_path TO aespacrm, public;

-- 1) Variantes equivalentes (BR: com/sem 9º dígito) --------------------
CREATE OR REPLACE FUNCTION aespacrm.phone_variants(p text)
RETURNS text[]
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  d text := regexp_replace(coalesce(p,''), '\D', '', 'g');
  ddd text;
  rest text;
  out_arr text[] := ARRAY[]::text[];
BEGIN
  IF d = '' THEN RETURN out_arr; END IF;
  out_arr := ARRAY[d];
  IF left(d, 2) = '55' AND length(d) >= 12 THEN
    ddd  := substr(d, 3, 2);
    rest := substr(d, 5);
    IF length(rest) = 9 AND left(rest, 1) = '9' THEN
      out_arr := out_arr || ('55' || ddd || substr(rest, 2));
    ELSIF length(rest) = 8 THEN
      out_arr := out_arr || ('55' || ddd || '9' || rest);
    END IF;
  END IF;
  RETURN out_arr;
END
$$;

-- 2) Trigger de contato: casa por variantes ----------------------------
CREATE OR REPLACE FUNCTION aespacrm.set_is_ignored_on_contact()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = aespacrm, public AS $$
DECLARE
  is_blk boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM aespacrm.crm_ignored_phones b
     WHERE b.user_id = NEW.user_id
       AND b.phone_norm = ANY (aespacrm.phone_variants(NEW.phone))
  ) INTO is_blk;
  NEW.is_ignored := is_blk;
  RETURN NEW;
END
$$;

-- 3) Trigger da blacklist: casa por variantes --------------------------
CREATE OR REPLACE FUNCTION aespacrm.sync_contacts_on_blacklist_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = aespacrm, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE aespacrm.crm_contacts
       SET is_ignored = true
     WHERE user_id = NEW.user_id
       AND NEW.phone_norm = ANY (aespacrm.phone_variants(phone));

    UPDATE aespacrm.crm_contact_sequences cs
       SET status = 'paused',
           paused_at = now(),
           pause_reason = 'blacklisted'
      FROM aespacrm.crm_contacts c
     WHERE cs.contact_id = c.id
       AND cs.status = 'active'
       AND c.user_id = NEW.user_id
       AND NEW.phone_norm = ANY (aespacrm.phone_variants(c.phone));
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    UPDATE aespacrm.crm_contacts c
       SET is_ignored = false
     WHERE c.user_id = OLD.user_id
       AND OLD.phone_norm = ANY (aespacrm.phone_variants(c.phone))
       AND NOT EXISTS (
         SELECT 1 FROM aespacrm.crm_ignored_phones b
          WHERE b.user_id = OLD.user_id
            AND b.phone_norm = ANY (aespacrm.phone_variants(c.phone))
       );

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
       AND OLD.phone_norm = ANY (aespacrm.phone_variants(c.phone))
       AND NOT EXISTS (
         SELECT 1 FROM aespacrm.crm_ignored_phones b
          WHERE b.user_id = OLD.user_id
            AND b.phone_norm = ANY (aespacrm.phone_variants(c.phone))
       );
    RETURN OLD;
  END IF;
  RETURN NULL;
END
$$;

-- 4) Backfill: re-marca contatos que perderam o is_ignored -------------
UPDATE aespacrm.crm_contacts c
   SET is_ignored = true
 WHERE c.is_ignored = false
   AND EXISTS (
     SELECT 1 FROM aespacrm.crm_ignored_phones b
      WHERE b.user_id = c.user_id
        AND b.phone_norm = ANY (aespacrm.phone_variants(c.phone))
   );

-- 5) Backfill: repausa sequências ativas de contatos blacklistados -----
UPDATE aespacrm.crm_contact_sequences cs
   SET status = 'paused',
       paused_at = now(),
       pause_reason = 'blacklisted'
  FROM aespacrm.crm_contacts c
 WHERE cs.contact_id = c.id
   AND cs.status = 'active'
   AND c.is_ignored = true;

-- 6) Conferência (opcional) --------------------------------------------
-- SELECT count(*) FROM aespacrm.crm_contacts WHERE is_ignored;
-- =====================================================================
