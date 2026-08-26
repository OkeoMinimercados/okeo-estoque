# OKEO 4.1 Final

Versão de estabilização final do OKEO Gestão.

Principais mudanças de arquitetura:
- snapshot inicial por store para preparar a Base Central rapidamente;
- validação por quantidade + checksum antes de ativar Produção;
- versão frontend/backend obrigatoriamente compatível;
- epoch de snapshot por dispositivo para impedir escrita com base desatualizada;
- Base Central como fonte oficial após ativação de Produção;
- migração de dados versionada;
- invariantes operacionais automáticos;
- pré-checagem ao iniciar;
- backup 4.1 + restauração com rollback lógico;
- fluxo de compra imediato e via CD separado;
- Saúde do Sistema e registro de erros;
- suíte de regressão incorporada.

Publicação:
1. Publique este pacote no GitHub Pages.
2. Publique `OKEO_4_1_FINAL_APP_WEB_BACKEND.gs` como NOVA VERSÃO da implantação Apps Script existente.
3. Confirme frontend 4.1.0 e backend 4.1.0.
4. No computador que contém a base correta, use:
   Saúde do Sistema → Preparar Base Central para Produção.
5. Nos demais dispositivos, use:
   Atualizar este dispositivo pela Central.

Não use versões antigas do frontend com o backend 4.1.
