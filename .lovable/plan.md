# Rodízio automático de Status do WhatsApp Business

## Objetivo
Criar no ZapCRM uma biblioteca de conteúdos que publique automaticamente no Status de 24 horas do WhatsApp Business conectado à instância `zapcrm`.

## Experiência no CRM
- Adicionar uma nova página **Status** no menu.
- Permitir incluir várias imagens, vídeos e áudios de uma vez, além de criar Status de texto.
- Exibir a fila na ordem de publicação, com prévia, legenda, posição e estado ativo/inativo.
- Permitir reordenar, editar legenda/texto e excluir itens.
- Configurar o intervalo entre publicações, com mínimo seguro de 60 minutos.
- Incluir controles para ativar/pausar a automação e um botão **Publicar agora** para testar um item.
- Mostrar qual será o próximo conteúdo, a última publicação e eventuais falhas.
- Publicar para todos os contatos, conforme solicitado.

## Automação
- Criar um processo separado no n8n chamado **[ZapCRM] Status Rotation**.
- O n8n consultará o CRM periodicamente; o CRM decidirá se o intervalo configurado já venceu.
- A cada execução válida, publicar somente o próximo item ativo da fila e avançar o rodízio.
- Depois do último item, voltar automaticamente ao primeiro.
- Impedir duas publicações simultâneas com uma reserva temporária persistida.
- Registrar cada tentativa, resposta da Evolution API e horário da publicação.
- Em falha, manter o item como próximo e mostrar o erro no CRM, sem avançar silenciosamente.

## Dados e segurança
- Criar somente tabelas `crm_*` dentro do schema `aespacrm`, com isolamento por usuário.
- Criar uma área privada de arquivos para as mídias, separada por usuário.
- Entregar à Evolution API um endereço temporário da mídia apenas no momento da publicação.
- Manter as chaves da Evolution API e do banco somente no servidor.
- Proteger ações da tela com a sessão do usuário e o acionamento do n8n com a chave já existente.
- Não alterar workflows existentes nem tocar na instância `roboaespa`.

## Tipos de Status
- **Imagem:** arquivo e legenda opcional.
- **Vídeo:** arquivo e legenda opcional.
- **Áudio:** arquivo e legenda opcional, sujeito ao suporte da versão instalada da Evolution API.
- **Texto:** conteúdo, cor de fundo e estilo de fonte.

## Validação
- Testar primeiro uma publicação manual de texto e uma de mídia na instância `zapcrm`.
- Validar upload múltiplo, reordenação, pausa, retomada e volta ao primeiro item.
- Confirmar que uma falha não pula conteúdo nem gera duplicidade.
- Verificar a página no celular e no computador.
- Confirmar o workflow dedicado no n8n sem executar ou modificar workflows alheios.

## Dependência operacional
A estrutura do banco será entregue em uma migração SQL idempotente para o Supabase self-hosted. A automação só poderá ser ligada após essa migração ser aplicada e o teste real confirmar que a versão instalada da Evolution API aceita `sendStatus`.
