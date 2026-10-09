# Ativação segura da repetição semanal

Não recriar sequências, reinscrever contatos, apagar reservas nem ativar outro disparador.

## Ordem obrigatória
1. Executar `SUPABASE_MIGRATION_SEQUENCE_WEEKLY_ROUNDS.sql` no editor SQL do servidor dedicado. Ela prepara as rodadas sem ativar repetição nem modificar os dados antigos.
2. Publicar o CRM atualizado. Antes da ativação, as sequências continuam no funcionamento antigo.
3. Pausar somente `[ZapCRM] Sequences Runner` (`YMW0Rj12DcZVHjFK`) e aguardar execuções já iniciadas terminarem. Não alterar outros workflows ou credenciais.
4. No GET `/api/public/sequences/due`, adicionar `recurring=1`. Preservar demais parâmetros.
5. No corpo do nó `Reserve dispatch`, adicionar `occurrence_id` do item do Loop, preservando `contact_sequence_id` e `step_order`. Campos ausentes de itens antigos devem ser omitidos, nunca enviados como string vazia.
6. No POST `/api/public/sequences/sent` da saída de envio confirmado, adicionar `claim_id` da saída do nó `Reserve dispatch`. Preservar contato e `status: sent`.
7. Manter os caminhos `Acknowledged? → Wait client interval → Loop` e `Invalid WhatsApp number? → Reject invalid number → Acknowledged?`. A confirmação e a rejeição escolhem automaticamente o tipo de reserva pelo `claim_id`. Não ligar falhas incertas à continuação nem habilitar retry nos nós de envio.
8. Conferir as expressões e a versão salva do workflow, SEM executá-lo nem disparar mensagens de teste.
9. Executar `SUPABASE_ACTIVATE_SEQUENCE_WEEKLY_ROUNDS.sql`. Havendo reservas sem confirmação, ele para sem apagar nada. Investigar as reservas antes de prosseguir.
10. Reativar somente o disparador oficial. Conferir no CRM os dias, horários, intervalo, próxima rodada e avisos de números inválidos.

## Comportamento
- O início de cada rodada é a abertura da janela de cada dia marcado, no fuso `America/Sao_Paulo`. Rodadas anteriores à ativação não são criadas.
- Cada rodada tem progresso e reservas próprios. Etapas posteriores respeitam os atrasos salvos e as janelas; uma rodada não sobrescreve a outra.
- Contatos concluídos continuam elegíveis nas próximas rodadas. Contatos pausados, cancelados ou excluídos permanecem impedidos. A retomada por resposta segue a configuração existente.
- A ativação converte somente inscrições concluídas para ativas, sem apagar histórico. Assim, os caminhos existentes de pausa por resposta e mudança de etapa continuam protegendo quem aguarda a próxima rodada. Novos inscritos após a abertura entram na próxima data marcada.
- Uma rodada não iniciada expira se não couber no dia. Uma rodada já iniciada preserva suas etapas pendentes; nenhuma reserva incerta é expirada ou reenviada automaticamente.
- Número inexistente (400 com `exists:false`) é registrado, pausa só esse contato e libera o próximo após o intervalo. Erros incertos continuam reservados.
- O teste direto de campanha antiga não antecipa rodadas semanais. Os testes individuais de mensagem/mídia continuam disponíveis.

## Verificação sem envio
Consultar somente `aespacrm.crm_sequences`, `crm_sequence_occurrences`, `crm_sequence_dispatches` e `crm_sequence_send_log`, filtrando pelo dono. Não chamar endpoints Evolution nem testar workflow ativo. A preparação de rodadas é feita pelo runner; o GET sem `recurring=1` não cria rodadas e nunca fornece itens semanais ao runner antigo.