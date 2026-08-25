# OKEO Core V3.67

Versão final corrigida após revisão ponta a ponta da V3.67.

## Correções principais
- Reposição operacional volta a abrir corretamente dentro de Compras.
- Histórico de reposições de homologação é limpo uma única vez na migração V3.67 (perfil Administrador).
- Gestão de Estoque possui aba própria **Análise de divergências**, comparando estoque esperado x contagem física/manual.
- Cada produto pode ter somente **um fornecedor ativo**; atribuição a novo fornecedor desativa o vínculo anterior e atualiza a Base Mestre.
- Cadastro de fornecedores exibe apenas o **total de fornecedores ativos** como indicador agregado.
- Mantidas as correções V3.67 de Produto × Condomínio, planogramas oficiais, desempenho e cache.
- Service Worker usa cache exclusivo `okeo-core-v3-46-final`.

## Publicação
Publique todo o conteúdo do pacote GitHub, inclusive `seed-planograms-v3.67.json`, e publique o Apps Script V3.67. Depois, atualize forçadamente o navegador/PWA para substituir o cache anterior.


## V3.67 — correção crítica de Gestão de Estoque
- Corrigida estrutura HTML: Controle Geral, Gestão por Condomínio e Análise de divergências agora são painéis irmãos independentes.
- Na V3.67 os dois últimos painéis estavam aninhados dentro de Controle Geral e eram ocultados junto com ele.


## V3.67
Correção de inicialização/bind, filtros robustos, fornecedor canônico, CD aguardando recebimento e múltiplas validades.
