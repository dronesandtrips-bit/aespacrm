# Fase 2 — Uma única conexão de WhatsApp para o ZapCRM e o Robô

## Objetivo
Ter só um aparelho conectado no celular. Cada mensagem recebida ou enviada pelo número chega ao ZapCRM e ao Robô ao mesmo tempo. As quedas causadas pelas duas conexões brigando acabam.

## Como vai funcionar
```text
Celular (1 aparelho conectado)
        |
  Conexão única "zapcrm" (Evolution)
        |
  Recebimento do ZapCRM  ──grava no CRM (como hoje)
        |
        └── repassa uma cópia idêntica ──> Recebimento do Robô
                                              |
                     Robô responde usando a conexão "zapcrm"
```

## Decisão: qual conexão mantemos
A conexão mantida será a **zapcrm**, porque todo o ZapCRM já envia por ela: textos, anexos, sequências, Status, Bling e o escudo. Assim o ZapCRM não muda nada nos envios. Quem passa a usar a conexão compartilhada é o Robô, que só precisa de um ajuste de configuração no projeto dele.

## Passo a passo
1. **Repasse ao Robô (ZapCRM).** Depois que o ZapCRM processa cada aviso, ele envia uma cópia exata ao endereço que o Robô já usa hoje para receber mensagens. Isso inclui as mensagens enviadas pelo próprio número, que fazem os comandos "off" e "on" do escudo funcionarem. O repasse fica numa fila: se o Robô estiver fora do ar, o ZapCRM continua funcionando e o repasse tenta de novo depois. O repasse começa desligado e só é ligado no passo 4.
2. **Robô envia pela conexão zapcrm (projeto Robô).** O nome da conexão usada pelo Robô muda de `roboaespa` para `zapcrm`, inclusive na página de status. Nada mais muda na lógica do Robô.
3. **Proteção contra respostas em ciclo.** Confirmar que o Robô ignora as mensagens que ele mesmo enviou. Hoje ele já recebe essas mensagens pela conexão dele, então o comportamento esperado é o mesmo. Isso será testado antes de ativar.
4. **Ativação controlada.** Ligar o repasse e trocar a conexão do Robô juntos, testando com o seu próprio número:
   - cliente envia mensagem: aparece no CRM e o Robô responde uma única vez;
   - texto, anexo e sequência enviados pelo CRM: chegam normalmente;
   - escudo desligado e religado: o Robô pausa e retoma;
   - os indicadores de enviado, entregue e lido continuam funcionando.
5. **Desligar a conexão extra.** Só depois dos testes, desconectar a `roboaespa` no celular em Aparelhos conectados. A conexão continua cadastrada na Evolution, sem ser excluída, para permitir voltar atrás.

## Como voltar atrás
Desligar o repasse e voltar o Robô para `roboaespa`, reconectando o QR Code dele. Nenhum dado se perde.

## Riscos e cuidados
- Se a conexão única cair, o Robô e o CRM param juntos. O aviso de queda que já existe no CRM continua valendo para os dois.
- O histórico guardado só na `roboaespa` não migra automaticamente.
- O passo 2 exige acesso ao projeto do Robô. Vou pedir esse acesso no momento de executar.

## Detalhes técnicos
- `src/routes/api.public.evolution.webhook.ts`: após o processamento atual, faz um repasse que não bloqueia o ZapCRM: um `POST` com o corpo original e a mesma `apikey` para `ROBO_WEBHOOK_URL` (`https://robo.aespa.com.br/api/public/evolution-webhook`). O repasse é ligado por uma flag em `crm_app_secrets` (`ROBO_FORWARD_ENABLED`), com timeout de 5s. Falhas ficam registradas em uma tabela nova, `aespacrm.crm_webhook_forward_queue`, e são reenviadas por um job que tenta no máximo 3 vezes. O repasse só entrega avisos; ele nunca envia mensagens de WhatsApp.
- O repasse cobre os eventos messages.upsert, messages.update e connection.update. A instância no corpo será `zapcrm`, e o Robô precisa aceitar esse nome.
- Nenhuma alteração no escudo, nos envios, nas sequências ou na recuperação de mensagens perdidas.
- A conexão `roboaespa` não será tocada pelo ZapCRM. A troca acontece dentro do projeto Robô.
