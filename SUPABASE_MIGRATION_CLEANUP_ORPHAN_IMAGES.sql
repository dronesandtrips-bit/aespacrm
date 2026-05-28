-- Limpa placeholders órfãos de IMAGENS enviadas (from_me=true) que ficaram
-- sem message_id no banco e portanto aparecem como "Imagem indisponível"
-- na inbox (sem message_id não conseguimos baixar a mídia descriptografada
-- via /chat/getBase64FromMediaMessage do Evolution).
--
-- INTEGRIDADE: só remove imagens from_me=true SEM message_id.
-- Nada que tenha message_id, nenhuma imagem recebida (from_me=false),
-- nenhum áudio/documento/texto/sticker/vídeo é tocado.

set search_path = aespacrm;

delete from crm_messages
 where type = 'image'
   and from_me = true
   and message_id is null;
