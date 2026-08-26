# OKEO 4.1.7 — causa raiz da regressão para backend antigo

Foi identificada a causa raiz: `DEFAULT_BACKEND_URL` ainda apontava para a implantação antiga
`...0fuWgqjrcvgq`. Além disso, `resolveBackendUrl()` dependia da flag `okeo_backend_custom_allowed`.
Se essa flag não sobrevivesse a reload/login/cache, o sistema descartava a URL nova salva e
voltava silenciosamente para o backend 4.1.2.

Correções:
- default oficial alterado para a implantação controlada `...IJQBAutw`;
- URL explicitamente salva passa a ser autoridade, independentemente da flag antiga;
- `checkBackendCompatibility()` consulta diretamente a URL ativa;
- Saúde continua consultando diretamente a URL ativa;
- removida do frontend qualquer referência à implantação antiga;
- mantidas proteções de snapshot, fila, rollback e escrita incompatível.

Não preparar a Base Central até a Saúde mostrar backend 4.1.7 e pré-produção na implantação nova.
