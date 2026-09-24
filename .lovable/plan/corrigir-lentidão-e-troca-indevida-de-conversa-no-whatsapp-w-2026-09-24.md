# Corrigir lentidão e troca indevida de conversa no WhatsApp Web

## Objetivo
Tornar a digitação imediata e garantir que cada texto continue vinculado ao contato em que foi escrito.

## Alterações
- Isolar a lista pesada de mensagens para que ela não seja redesenhada a cada tecla.
- Remover o cálculo repetitivo que percorre o restante do histórico para cada mensagem.
- Manter um rascunho separado por conversa e restaurá-lo ao alternar contatos.
- Capturar o contato de destino no início do envio, impedindo que uma troca de conversa durante a espera redirecione o texto ou atualize a tela errada.
- Estabilizar o listener em tempo real para não desconectar e reconectar a cada troca de contato.
- Preservar anexos, respostas, emojis, notificações, lembretes e o envio pela instância `zapcrm`.

## Validação
- Conferir tipos e carregamento da página.
- Testar digitação com histórico grande, troca rápida entre contatos e envio enquanto outra conversa é aberta.
