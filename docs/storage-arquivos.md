# Storage e arquivos

| Recurso | Uso e acesso no código | Limites e formatos | Backup/risco |
|---|---|---|---|
| `crm-status-media` | [C] Bucket privado criado sob demanda por `status-library.ts`; upload por JWT autorizado, objeto em `<user_id>/<uuid>-<nome>`, preview assinado por 900s, publicação assinada por 600s; apagar item remove objeto | 20 MB; JPEG/PNG/WebP, MP4/WebM, MPEG/MP4/OGG/WAV/WebM áudio | [E] copiar objetos + metadados/storage e conferir URLs/ACL; banco sozinho não contém mídia. |
| `crm-avatars` | [C] Bucket público criado sob demanda por `avatar-cache.server.ts`; cópias do CDN WhatsApp, `<user_id>/<contact_id>.<ext>`, `x-upsert`, cache público | 2 MB; JPEG/PNG/WebP | [I] cache regenerável enquanto fonte existir; se a fonte expirou, perda irreversível; URLs públicas expõem imagens acessíveis sem login. |
| `crm_message_templates`, `crm_sequence_steps` | [C] Migration `TEMPLATE_MEDIA` acrescenta mídia em colunas; mensagens podem guardar base64 ou referências e Evolution serve mídia da conversa | [NV] limite efetivo por caminho não auditado integralmente | [E] preservar banco e retenção de mídia Evolution; verificar backup da VPS. |

**[NV]** Buckets reais, policies `storage.objects`, volumes físicos, criptografia, ciclo de vida, retenção e capacidade não foram consultados. A aplicação usa cliente service role para Storage; **não assumir** que bucket privado tem políticas de upload direto para usuários. **Download:** URL assinada para Status; URL pública para avatar; mensagens WhatsApp podem buscar base64 da Evolution. **Exclusão:** somente código de Status apaga arquivo quando item excluído (falha na remoção pode deixar órfão). Migração de bucket não está nos SQLs; reconstrução exige provisionar e conferir ambos.

**Recuperação:** exportar metadados de buckets e objetos *do ambiente isolado* + arquivos físicos pelos mecanismos oficiais do Storage; validar contagem/checksum e caminhos por usuário em ambiente de ensaio. Ao restaurar, importar objetos antes de liberar Status, conferir associação `crm_status_media.storage_path` e só então testar links assinados. Não copiar volumes de outros projetos nem publicar bucket privado.
