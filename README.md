# OKEO Core V3.44

Versão final corrigida após revisão ponta a ponta da V3.43.

## Correções principais
- Reposição operacional volta a abrir corretamente dentro de Compras.
- Histórico de reposições de homologação é limpo uma única vez na migração V3.44 (perfil Administrador).
- Gestão de Estoque possui aba própria **Análise de divergências**, comparando estoque esperado x contagem física/manual.
- Cada produto pode ter somente **um fornecedor ativo**; atribuição a novo fornecedor desativa o vínculo anterior e atualiza a Base Mestre.
- Cadastro de fornecedores exibe apenas o **total de fornecedores ativos** como indicador agregado.
- Mantidas as correções V3.43 de Produto × Condomínio, planogramas oficiais, desempenho e cache.
- Service Worker usa cache exclusivo `okeo-core-v3-44-final`.

## Publicação
Publique todo o conteúdo do pacote GitHub, inclusive `seed-planograms-v3.44.json`, e publique o Apps Script V3.44. Depois, atualize forçadamente o navegador/PWA para substituir o cache anterior.
