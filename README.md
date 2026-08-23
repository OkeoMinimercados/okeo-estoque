# OKEO Core V3.41

Versão consolidada de vínculo Base Mestre × Condomínios, mantendo as correções de navegação da V3.40.

- Dashboard abre imediatamente após login.
- Botão Dashboard permanente no topo.
- Sincronização ocorre em segundo plano sem redirecionar a tela atual.
- Tela automática de primeiro acesso removida do fluxo normal.
- Mantidas as integrações Produto × Condomínio e Fornecedor × Produto da V3.39.


## V3.41 — vínculo definitivo Base Mestre × Condomínios
- Relação histórica Produto × Condomínio incluída como referência local do frontend a partir das bases reais já usadas nos planogramas.
- Gestão de Estoque, Contagem Física, Validades, Compra Semanal, Reposição e Planograma usam `canonicalUnitProductEans()`.
- Planograma por Condomínio marca automaticamente os produtos oficiais da unidade; Condomínios por Produto usa a mesma relação.
- Tabelas operacionais ficaram mais compactas e responsivas.
- Corrigido ID HTML duplicado `utype`.

### Implantação V3.41
O arquivo `seed-planograms-v3.41.json` é parte obrigatória do frontend e deve ser publicado junto com os demais arquivos no GitHub Pages. Ele funciona como referência histórica para reconstrução Produto × Condomínio e não substitui a store `planograms`; alterações feitas pelo usuário no Planograma continuam sendo persistidas oficialmente.
