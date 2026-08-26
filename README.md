# OKEO Gestão 5.0 Stable

Release de estabilização. Esta versão congela a arquitetura operacional.

## Regras estruturais

- Uma única Base Central oficial: deployment `...IJQBAutw`.
- URL da Central não é uma configuração operacional editável.
- Sessões pertencem à Central que as emitiu.
- Snapshot é armazenado por deployment.
- Fila de sincronização é armazenada por deployment.
- Filas antigas sem origem entram em quarentena e nunca são enviadas.
- Um único coordenador controla sincronização automática.
- Nenhuma tela inicia sincronização independente.
- Hidratação automática foi removida; atualização integral do dispositivo é explícita.
- Escritas só são permitidas em READY; Administrador pode preparar a base em PREPRODUCTION.
- Service Worker usa rede primeiro e remove caches OKEO anteriores.

## Publicação

1. Publique `OKEO_5_0_0_STABLE_BACKEND.gs` como nova versão da implantação Apps Script
   cuja URL termina em `IJQBAutw/exec`.
2. Publique `OKEO_5_0_0_STABLE_GITHUB.zip` no GitHub Pages.
3. Faça uma única atualização forçada do navegador.
4. Entre manualmente.
5. No computador fonte, confira Saúde e prepare a Base Central para Produção.
6. Nos demais dispositivos, use Atualizar este dispositivo pela Central.

Não publique versões 4.1.x novamente sobre esta release.
