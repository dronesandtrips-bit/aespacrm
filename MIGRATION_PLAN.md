# ZapCRM — Migração para Supabase (Plano de Execução)

## ✅ Isolamento garantido

Tudo vive no schema **`aespacrm`** com prefixo **`crm_`** nas tabelas e RLS por `user_id`.
Outros projetos no seu Supabase self-hosted **não têm acesso** a estes dados.

---

## 📋 Passo 1 — Rodar o SQL no Supabase (VOCÊ FAZ)

1. Abra o SQL Editor do seu Supabase self-hosted
2. Cole e rode o arquivo **`SUPABASE_MIGRATION.sql`** (na raiz do projeto)
3. É idempotente — pode rodar várias vezes sem erro
4. Crie no mínimo as categorias e etapas iniciais (ou deixe o app criar)

### Tabelas criadas (todas em `aespacrm.crm_*`)

| Tabela | Para quê |
|---|---|
| `crm_categories` | Categorias de contato (Lead, Cliente, VIP...) |
| `crm_contacts` | Contatos (com phone normalizado e unique por usuário) |
| `crm_pipeline_stages` | Etapas do Kanban |
| `crm_pipeline_placements` | Em qual etapa cada contato está |
| `crm_messages` | Mensagens da Inbox |
| `crm_bulk_sends` | Histórico de disparos em massa |
| `crm_sequences` | Sequências de follow-up automático |
| `crm_sequence_steps` | Etapas de cada sequência |
| `crm_contact_sequences` | Quais contatos estão em quais sequências |
| `crm_sequence_send_log` | Log de envios das sequências |

---

## 📦 Status da migração no app

### ✅ Fase 1 (PRONTA — este turno)
- [x] SQL completo de TODAS as tabelas
- [x] RLS isolado por usuário em todas as tabelas
- [x] Cliente Supabase tipado em `src/lib/db.ts`
- [x] **Contatos** migrado para Supabase real

### ⏳ Fase 2 (próximo turno)
- [ ] Configurações (categorias + etapas) → Supabase
- [ ] Pipeline → Supabase
- [ ] Disparos → Supabase
- [ ] Inbox → Supabase
- [ ] Dashboard → Supabase

### ⏳ Fase 3 (depois da Fase 2)
- [ ] UI de Sequências (CRUD + editor de etapas)
- [ ] Triggers automáticos (mover contato → entra em sequência)
- [ ] Endpoints `/api/public/sequences/*` para o n8n
- [ ] Pausa por resposta na Inbox

---

## 🤖 Spec dos endpoints para o n8n (Fase 3)

Quando chegarmos na Fase 3, vou expor **2 endpoints públicos** protegidos por
secret HMAC para o n8n consumir:

### `GET /api/public/sequences/due`
**O que faz:** retorna mensagens de follow-up vencidas e prontas pra enviar
(respeitando janela 9h-18h seg-sex).

**n8n chama via Cron Trigger a cada hora:**
```
GET https://aespacrm.lovable.app/api/public/sequences/due
Header: X-Sequences-Secret: <SEQUENCES_WEBHOOK_SECRET>
```

**Response:**
```json
{
  "due": [
    {
      "log_id": "uuid-temp",
      "contact_sequence_id": "uuid",
      "contact": { "id": "uuid", "name": "Ana", "phone": "+5511..." },
      "sequence": { "id": "uuid", "name": "Follow-up VIP" },
      "step_order": 2,
      "message": "Olá Ana, ainda interessada?"
    }
  ]
}
```

**Após enviar, n8n faz POST de confirmação:**
```
POST /api/public/sequences/sent
Header: X-Sequences-Secret: <SEQUENCES_WEBHOOK_SECRET>
Body: { "log_id": "uuid", "status": "sent" | "failed", "error": "..." }
```

### `POST /api/public/sequences/inbound`
**O que faz:** quando o contato responde no WhatsApp, o n8n notifica
o CRM para pausar TODAS as sequências ativas daquele contato.

```
POST https://aespacrm.lovable.app/api/public/sequences/inbound
Header: X-Sequences-Secret: <SEQUENCES_WEBHOOK_SECRET>
Body: {
  "phone": "+5511912345678",
  "user_id": "uuid-do-dono-da-conta",   // opcional se phone for único
  "body": "texto da mensagem recebida"
}
```

**O CRM faz:**
1. Encontra o contato pelo telefone (normalizado)
2. Marca todas as `crm_contact_sequences` ativas como `paused` (reason='inbound_reply')
3. Insere a mensagem na `crm_messages` (from_me=false)

### Secret necessário (Fase 3)
Vou pedir pra você criar a secret `SEQUENCES_WEBHOOK_SECRET` quando chegarmos lá.

---

## 🧪 Como testar a Fase 1 agora

1. **Rode o `SUPABASE_MIGRATION.sql`** no seu Supabase
2. Faça login no app
3. Vá em **Contatos** → crie um contato novo
4. Recarregue a página → o contato deve persistir (não some mais!)
5. Confira no SQL: `SELECT * FROM aespacrm.crm_contacts;`

⚠️ **Importante:** as categorias da tela de Contatos virão vazias até você
criar via Configurações (que ainda usa mock — Fase 2). Por enquanto, dá pra
criar uma categoria direto no SQL pra testar:

```sql
insert into aespacrm.crm_categories (user_id, name, color)
values (auth.uid(), 'Lead', '#3B82F6');
```
(rode logado no Supabase como o mesmo usuário, ou troque `auth.uid()` pelo ID do seu user)

---

## ❓ Posso seguir pra Fase 2?

Quando você confirmar que:
- ✅ rodou o SQL sem erros
- ✅ conseguiu criar um contato e ele persiste após reload

…me responda **"pode seguir Fase 2"** e eu migro Configurações + Pipeline + Disparos + Inbox + Dashboard de uma vez no próximo turno.
