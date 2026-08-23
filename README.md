# OKEO Core V3.54

Versão final corrigida após revisão ponta a ponta da V3.54.

## Correções principais
- Reposição operacional volta a abrir corretamente dentro de Compras.
- Histórico de reposições de homologação é limpo uma única vez na migração V3.54 (perfil Administrador).
- Gestão de Estoque possui aba própria **Análise de divergências**, comparando estoque esperado x contagem física/manual.
- Cada produto pode ter somente **um fornecedor ativo**; atribuição a novo fornecedor desativa o vínculo anterior e atualiza a Base Mestre.
- Cadastro de fornecedores exibe apenas o **total de fornecedores ativos** como indicador agregado.
- Mantidas as correções V3.54 de Produto × Condomínio, planogramas oficiais, desempenho e cache.
- Service Worker usa cache exclusivo `okeo-core-v3-46-final`.

## Publicação
Publique todo o conteúdo do pacote GitHub, inclusive `seed-planograms-v3.54.json`, e publique o Apps Script V3.54. Depois, atualize forçadamente o navegador/PWA para substituir o cache anterior.


## V3.54 — correção crítica de Gestão de Estoque
- Corrigida estrutura HTML: Controle Geral, Gestão por Condomínio e Análise de divergências agora são painéis irmãos independentes.
- Na V3.54 os dois últimos painéis estavam aninhados dentro de Controle Geral e eram ocultados junto com ele.


## V3.54
Correção de inicialização/bind, filtros robustos, fornecedor canônico, CD aguardando recebimento e múltiplas validades.
