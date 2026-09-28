# ZapCRM / Aespa — documentação técnica

**Auditoria:** 28/09/2026, 23:07 UTC. **Revisão analisada:** `07a92373b3bd66d4149b142dc64ed67dd3eb22db`. **Produção declarada:** https://crm.aespa.com.br/. **Estado:** inventário do código concluído; infraestrutura e catálogo real do banco pendentes de inspeção administrativa somente leitura. Nenhuma mudança em dados, aplicação ou serviços foi realizada nesta auditoria.

**Legenda de evidência:** **[C] confirmado diretamente** no código/arquivo/configuração ou listagem de conexão; **[I] inferido** do comportamento implementado; **[NV] não verificado** no ambiente real; **[E] depende de infraestrutura externa**. O que o código *prevê* não comprova o estado efetivo de produção.

**Objetivo:** centralizar contatos, conversas WhatsApp, pipeline de vendas, agenda, disparos, sequências, Status, Bling, automações e captura pública. Arquitetura: React/TanStack Start em execução na hospedagem Lovable/Worker → chamadas autenticadas e APIs próprias → Supabase auto-hospedado na VPS (`aespacrm.crm_*`), Evolution `zapcrm`, n8n, Bling e Google Calendar. Os serviços da VPS são compartilhados; nunca atuar em `roboaespa` ou em schemas de outros projetos. [C: `AGENTS.md`, `src/integrations/supabase/server.ts`, `src/routes/api.public.evolution.status-tick.ts`]

## Índice
- [Arquitetura e fluxos](arquitetura.md)
- [Inventário técnico e dependências](inventario-tecnico.md)
- [Módulos, operações e testes](modulos-e-funcionalidades.md)
- [Banco, migrações, backup e restauração](banco-de-dados.md)
- [Autenticação e autorização](autenticacao-autorizacao.md)
- [Storage e arquivos](storage-arquivos.md)
- [Integrações externas](integracoes-externas.md)
- [Evolution e WhatsApp](evolution-whatsapp.md)
- [Catálogo extraído dos SQLs e rotas](catalogo-estatico.md)

## Ambientes auditados e lacunas
- **[C]** Cópia de trabalho local, código-fonte, 43 arquivos SQL locais, configurações, lista de nomes de secrets do projeto (valores não lidos), listagem de conexões: Google Calendar ligado; outras conexões listadas não são necessariamente usadas pela aplicação.
- **[NV]** Publicação implantada pode diferir desta revisão; não foi feito login, consulta direta ao PostgreSQL/Storage/Auth de produção, inventário da VPS/Portainer, n8n, Evolution Manager, DNS/Cloudflare ou provas de restauração. Não há acesso SQL somente leitura configurado para esta auditoria; não se presume que scripts locais estejam aplicados.
- **[E]** Solicitar ao administrador, em canal seguro, inventário **sem dados pessoais ou credenciais**: `pg_catalog`/`information_schema` do schema isolado, políticas/grants, extensões, versão PostgreSQL, lista de buckets, configuração Auth (redirecionamentos, e-mail), dump validado, lista de serviços/volumes/versões Docker, status e export *sanitizado* dos workflows `[ZapCRM]`, configurações DNS/proxy e backups. Não inserir segredos aqui.
- **[NV]** `crm_ai_enrichment_logs` é referenciada no código sem `CREATE TABLE` nos SQLs locais; existência em produção desconhecida. `SUPABASE_ROLLBACK_BOT_PROMPTS.sql` não tem migração de criação correspondente. A ordem total de 43 scripts não é demonstrável sem comparar o catálogo real e a sequência histórica de execução. Veja [banco](banco-de-dados.md).

> Antes de qualquer alteração em banco, pedir aprovação explícita. Este conjunto é documentação e não autorização para rodar comandos de restauração ou migração.
