# Inventário técnico e dependências

**[C]** Checkout da revisão indicada no [índice](README.md). Pacotes listados em `package.json` com faixas declaradas; versões efetivamente resolvidas dependem do lockfile e instalação. `bun.lock` **e** `package-lock.json` coexistem: escolher uma ferramenta e congelar dependências ao reconstruir, sem supor que ambos representem a mesma árvore. Scripts: `dev`, `build`, `build:dev`, `preview`, `lint`, `format`. Gerenciador usado no ambiente de trabalho: Bun; produção usa artefato compilado. `node --version` da VPS/build remoto **[NV]**; `@types/node` 22.16.5 não é versão de runtime.

## Componentes do stack
| Dependência (faixa declarada) | Função e uso | Produção? / risco de troca |
|---|---|---|
| `react`/`react-dom` ^19.2.0; `@tanstack/react-start` ^1.167.14, `@tanstack/react-router` ^1.168.0 | Interface, SSR/rotas `src/routes/*` | Sim; atualização requer testar hidratação/roteamento. |
| `@supabase/supabase-js` ^2.104.0 | Auth, PostgREST/RLS, Storage, Realtime em `src/integrations/supabase/*` e `src/lib/db.ts` | Sim; risco em sessão/schema/assinaturas realtime. |
| `zod` ^4.3.6 | Validação de entradas HTTP/formulários | Sim; mudanças de parsing quebram contratos. |
| `@tanstack/react-query` ^5.83.0 | Cache/consultas em telas e funções | Sim onde importado; checar invalidation. |
| `tailwindcss`/`@tailwindcss/vite` ^4.2.1, `tw-animate-css` ^1.3.4 | Tema/UI em `src/styles.css`, build | Sim; remoção afeta estilos. |
| `@radix-ui/react-*` (versões individuais em `package.json`), `class-variance-authority` ^0.7.1, `clsx` ^2.1.1, `tailwind-merge` ^3.5.0 | Primitivos `src/components/ui/*`/variantes | Sim por componente; testar menus, diálogos, acessibilidade. |
| `lucide-react` ^0.575.0, `sonner` ^2.0.7 | Ícones e notificações | Sim; mudança visual/feedback. |
| `@dnd-kit/core` ^6.3.1, `@dnd-kit/sortable` ^10.0.0, `@dnd-kit/utilities` ^3.2.2 | Arrastar/ordenar pipeline e listas | Sim onde usado; testar touch. |
| `recharts` ^3.8.1 | Gráficos do painel | Sim na tela; dados/legendas podem mudar. |
| `date-fns` ^4.1.0, `react-day-picker` ^9.14.0 | Datas e agenda | Sim; cuidado com fuso São Paulo. |
| `react-hook-form` ^7.71.2, `@hookform/resolvers` ^5.2.2 | Forms/validação | Sim onde usados. |
| `emoji-picker-react` ^4.19.1 | Emoji do chat, carregamento sob demanda em `LazyEmojiPicker` | Sim para emoji; remover quebra seletor. |
| `papaparse` ^5.5.3 | Importação de planilhas/listas | Sim onde usado; preservar normalização. |
| `vite` ^7.3.1, `@lovable.dev/vite-tanstack-config` 2.23.1, `@cloudflare/vite-plugin` ^1.25.5, `nitro` 3.0.260603-beta | Compilação, runtime Worker; `vite.config.ts`, `wrangler.jsonc` | Necessários para gerar deploy; beta demanda cuidado. |
| `typescript` ^5.8.3, ESLint ^9.32.0, Prettier ^3.7.3 e plugins | Desenvolvimento/verificação | Não necessários no bundle, mas essenciais para reproduzir build. |

Demais dependências diretas: `@tanstack/router-plugin`, `@tanstack/zod-adapter`, `@types/papaparse`, `cmdk`, `embla-carousel-react`, `input-otp`, `react-resizable-panels`, `react-day-picker`, `vaul`, `vite-tsconfig-paths`, `@vitejs/plugin-react`, `@eslint/js`, `@types/node`, `@types/react`, `@types/react-dom`, `eslint-config-prettier`, `eslint-plugin-prettier`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `globals`, `typescript-eslint`; versão exata/necessidade por importação: consultar `package.json` + lockfile. A remoção de qualquer dependência importada pode impedir build; não atualizar em produção sem regressão. Sem dependência npm dedicada de WhatsApp: comunicação pela API HTTP Evolution. Sem SDK SMTP/Resend no manifesto. [C]

## Organização
- `src/routes/__root.tsx`, `index.tsx`, `_app.tsx`, `_app.*.tsx`: shell e páginas; `api.public.*.ts`: handlers HTTP; `src/router.tsx`: router; `src/routeTree.gen.ts`: gerado, não editar. Rotas completas: [catálogo](catalogo-estatico.md).
- `src/lib/db.ts`: adaptadores `categoriesDb`, `contactsDb`, `pipelineDb`, `messagesDb`, `bulkSendsDb`, `sequencesDb`, `widgetsDb`, `templatesDb`, `userSettingsDb`, `ignoredPhonesDb`; helpers `phone-validation.ts`, `auth-fetch.ts`, `media-cache.ts`, `maps-link.ts`, `appointment-detect.ts`, `notification-sound.ts`, `utils.ts`; hooks `use-global-message-ping.ts`, `use-mobile.tsx`.
- Componentes de negócio: `AppShell`, `AppSidebar`, `AppHeader`, `AgendaWeekView`, `ScheduleEventDialog`, `BlingAutoCard`, `BlingIntegrationCard`, `BlingImportDialog`, `BlingOrphanCleanupDialog`, `DuplicateScanDialog`, `LazyEmojiPicker`, `contact-dialogs`; primitivos em `src/components/ui/`.
- Serviços: `src/server/bling.server.ts`, `bling-auto.server.ts`, `bulk-dispatch.server.ts`, `optout.server.ts`, `evolution-global-key.server.ts`; `src/lib/*.server.ts` para agenda, cache, presença. [C]

## Configuração e nomes de ambiente (sem valores)
**[C]** `AESPACRM_SUPA_URL`, `AESPACRM_SUPA_ANON_KEY`, `AESPACRM_SUPA_SERVICE_KEY` (server); `VITE_AESPACRM_SUPA_URL`, `VITE_AESPACRM_SUPA_ANON_KEY` (configuração pública opcional do browser); `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_GLOBAL_API_KEY`, `EVOLUTION_OWNER_USER_ID`; `N8N_API_KEY`; `GOOGLE_CALENDAR_API_KEY`, `LOVABLE_API_KEY`; `BLING_TOKEN_PROXY_URL`, `BLING_REDIRECT_URI`; `ZAPCRM_PUBLIC_URL`, `ZAPCRM_OWNER_PHONE`, `ZAPCRM_AUTO_BOOK`. Cofre por usuário `crm_app_secrets`: `BLING_CLIENT_ID`, `BLING_CLIENT_SECRET`, `BLING_TOKENS`, `BLING_OAUTH_STATE`, `EVOLUTION_GLOBAL_API_KEY` (valores jamais em git/docs). Nomes adicionais presentes na lista de secrets do projeto: `BOT_SYNC_TOKEN`, `UAZAPI_TOKEN`; uso ativo no código auditado **[NV]**. Disponibilidade em produção não se deduz da presença na listagem do projeto.

Arquivos: `tsconfig.json` (TS strict/alias), `vite.config.ts` (chunking/sourcemaps), `wrangler.jsonc` (Worker nodejs_compat), `components.json`, `bunfig.toml`, `eslint.config.js`, `.prettierrc`, `.prettierignore`, `N8N_*_NODES.json` (referências, não prova de deploy). **[NV]** versão Node/OS, comandos CI/deploy, variáveis de build, releases e telemetria reais.
