# Sequências com repetição semanal

## Por que não acontece hoje
Os dias marcados atualmente apenas autorizam o envio dentro da janela escolhida. Depois da última mensagem, o contato fica como “concluído”, sem um próximo envio programado. Além disso, a proteção contra duplicação identifica a tentativa apenas pelo contato e pela etapa, sem distinguir uma segunda-feira da semana seguinte.

Isso não corresponde ao funcionamento solicitado. Não é necessário recriar suas sequências.

## Funcionamento solicitado
- Aplicar a repetição às sequências existentes e às novas: cada dia marcado gera uma nova rodada, semanalmente, sem data final, até pausar ou excluir a sequência.
- Segunda e quinta significa toda segunda e toda quinta, começando no início da janela salva, no horário de Brasília. O intervalo entre clientes determina os horários seguintes; não significa enviar para todos ao mesmo tempo.
- Manter mensagens, mídias, destinatários, intervalos entre clientes, atrasos entre etapas e demais condições gravadas.
- Manter contatos excluídos, cancelados ou pausados fora do envio. As regras atuais de retomada por resposta permanecem respeitadas; a repetição não desbloqueia ninguém.
- Contatos que concluíram uma rodada continuam inscritos para as próximas, sem precisar reiniciar manualmente.
- Não disparar retroativamente as rodadas perdidas antes da ativação da correção.

## Contatos inválidos e avisos
- Preservar e verificar o tratamento já existente: recusa definitiva de número inexistente registra o problema, pausa apenas esse contato e permite continuar com os demais, respeitando o intervalo.
- Exibir o nome, telefone, sequência e motivo no aviso de falhas da tela de Sequências e no histórico.
- Diferenciar contato inválido de envio sem confirmação: tempo esgotado ou resposta incerta não prova que a mensagem deixou de ser entregue. Manter a proteção atual nesses casos, sem reenvio ou liberação automática.

## Implementação técnica
1. Adicionar controle persistente de rodadas por data programada e por inscrição no schema `aespacrm`, usando apenas tabelas `crm_*`. Manter os registros e comprovantes antigos.
2. Identificar cada tentativa por rodada, contato e etapa; reservar e confirmar atomicamente, garantindo que duas execuções do disparador não enviem a mesma mensagem na mesma rodada.
3. Adaptar a seleção de mensagens pendentes e a confirmação de envio para agendar cada dia selecionado, em vez de encerrar permanentemente a inscrição. Cada rodada mantém seu próprio progresso em sequências com várias etapas; atrasos continuam válidos e não sobrescrevem outra rodada.
4. Revalidar janela, sequência ativa, exclusões e pausas antes de reservar cada envio. Rodadas ainda não iniciadas não viram uma fila de disparos históricos após uma pausa; envios já reservados nunca são apagados ou repetidos automaticamente.
5. Atualizar os indicadores de próxima rodada e conclusão da rodada na tela, sem confundir conclusão com pausa da inscrição.
6. Adaptar somente o disparador oficial `[ZapCRM] Sequences Runner`, preservando credenciais, mídia, intervalos e o caminho para números inválidos. Não criar nem ativar um segundo disparador.

## Verificação e ativação
- Testar segunda/quinta em semanas consecutivas, mudança de mês, horários de Brasília, pausa/exclusão, várias etapas e concorrência, sem enviar WhatsApp real durante os testes.
- Testar que número definitivamente inválido não bloqueia o próximo contato e que resultado ambíguo não gera duplicação.
- Preparar a atualização do banco para você executar no seu servidor, como nas correções anteriores; validar antes da ativação.
- Publicar o CRM e, com sua aprovação, atualizar o disparador ativo numa ordem que impeça envios pela versão antiga durante a troca.
- Conferir as próximas datas das sequências existentes, incluindo Clientes ISIC LITE e Clientes AMT Remoto, sem remover bloqueios ou fazer envios de teste.

## Limite importante
Se a quantidade de contatos e os intervalos não couberem na janela salva, não é possível garantir que todos recebam naquele mesmo dia sem contrariar suas condições. A implementação deve sinalizar esse caso, sem acelerar os envios ou ultrapassar o horário permitido.