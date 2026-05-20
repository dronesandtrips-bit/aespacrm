-- Limpa placeholders órfãos de documentos enviados (from_me=true) que
-- ficaram sem message_id no banco e portanto aparecem como
-- "Documento indisponível" na inbox. O webhook messages.upsert já
-- criou (ou criará) a linha definitiva com message_id e media_url.
-- INTEGRIDADE: só remove documentos from_me=true SEM message_id.
-- Nada que tenha message_id, nenhum áudio/imagem/texto é tocado.

set search_path = aespacrm;

delete from crm_messages
 where type = 'document'
   and from_me = true
   and message_id is null;
