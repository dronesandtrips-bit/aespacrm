# Evolution API e WhatsApp

**[C]** Instância exclusiva `zapcrm` referida nos handlers; **não tocar `roboaespa`**. URL via `EVOLUTION_API_URL`, chave via `EVOLUTION_API_KEY`; chave global opcional `EVOLUTION_GLOBAL_API_KEY` ou cofre `crm_app_secrets` para tarefas administrativas. Proteger cabeçalhos `apikey` e não registrar chave em docs/logs. Ver `src/routes/api.public.evolution.*`.

## Caminhos
| Operação | Código/HTTP | Efeito/falha |
|---|---|---|
| Estado/conexão/QR | `status`, `qr`, `test`, `create`, `configure-webhook`; `/instance/fetchInstances`, `/instance/connect`, `/instance/create` | [C] Somente instância `zapcrm`; [E] QR e configuração real são externas. |
| Mensagem de texto/mídia | `send`, `send-and-log`, `send-media`, `send-media-and-log`, `forward-*`; `POST /message/sendText`, `/message/sendMedia`, `/message/sendWhatsAppAudio` | [C] Salva em `crm_messages` onde aplicável; timeout pode ter enviado sem resposta: **não reenviar cegamente**. |
| Recebimento | `POST /api/public/evolution/webhook`, chave `apikey`; eventos `messages.upsert`, `messages.update`, `connection.update`, `contacts.upsert/update` | [C] Persiste `crm_webhook_events`, atualiza contatos/mensagens/estado, pausa sequências por resposta, pode detectar agenda; rejeita JID broadcast/status e instancia diferente. |
| Sincronização | `sync-contacts`, `sync-groups`, `sync-messages`, `media`, `check-number` | [C] Requer autenticação; API externa indisponível deixa dados desatualizados. |
| Disparos | `bulk-dispatch`, `bulk-tick` | [C] Tick chamado por n8n; estado no banco; conferir blacklist antes de envio. |
| Status | `status-library`, `status-tick`; `POST /chat/findContacts/zapcrm`, `POST /message/sendStatus/zapcrm` | [C] Snapshot fixo, 20 JIDs por lote, `allContacts:false`, próximo índice no banco; incerteza pausa. |

**[C]** Teste Status individual e de 2–5 contatos por números explícitos não consulta lista geral. O botão geral captura lista da instância e envia um lote de até 20 por chamada. `crm_status_runs` conserva `recipients`, `next_index`, `in_flight_at` e `status`; se timeout/erro após reserva, marca `uncertain`, desliga rodízio, exige conferência manual. `accepted` significa **resposta da API**, não leitura/entrega comprovada no aparelho. `N8N_STATUS_ROTATION_NODES.json` descreve intervalo de 5 minutos, porém workflow real deve ser verificado no n8n. Rodízio geral não validado; não ativar com base no teste de até cinco. [E] O erro HTTP 524 e atraso de `sendText` dependem de logs da VPS; não foram resolvidos por esta auditoria.

**Procedimento seguro de teste [E]:** somente administrador autorizado e destinatários de confiança; manter rodízio pausado, selecionar conteúdo e grupo explícito, executar **uma vez**, confirmar no aparelho de cada destinatário, conferir checkpoint/status no CRM; em resposta ambígua não repetir lote. Nunca executar consulta de envio para fins de auditoria sem permissão específica. Para substituir Evolution, criar adaptador que preserve webhook, identificação JID, mídia, logs, autenticação e semântica de resposta incerta; testar fora da produção antes de migração.
