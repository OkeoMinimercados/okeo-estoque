# OKEO Core V3.41 — Homologação Final

Data: 23/08/2026

## Objetivo da correção
A V3.41 consolida a relação **Base Mestre × Produto × Condomínio** em uma única fonte lógica usada pelos módulos operacionais. A correção foi motivada por telas em que a Base Mestre estava carregada, mas Gestão de Estoque/Planograma indicavam zero produtos para a unidade.

## Correções implementadas
1. `canonicalUnitProductEans()` permanece como fonte única de Produto × Condomínio.
2. Foi incluída `seed-planograms-v3.41.json`, reconstruída a partir da Base Mestre consolidada e dos arquivos de origem dos planogramas já utilizados anteriormente.
3. A relação canônica passa a reunir: Planogramas sincronizados, `products.unitIds`, Estoque (inclusive saldo zero), Demanda e a relação histórica de referência.
4. Um vínculo explicitamente desmarcado no Planograma (`active=false`) prevalece sobre fontes auxiliares/legadas, evitando que produtos retirados reapareçam.
5. **Gestão de Estoque por Condomínio** usa a relação canônica.
6. **Contagem de Estoque Física** usa a mesma relação canônica.
7. **Validades** usa a mesma relação canônica.
8. **Planograma → Produtos por condomínio** abre com os produtos da unidade já marcados em relação à Base Mestre.
9. **Planograma → Condomínios por produto** foi validado e usa a mesma relação canônica.
10. **Cadastro de Produto → condomínios** recupera os vínculos pela relação canônica.
11. **Compra Semanal** filtra a demanda pelos produtos realmente vinculados a cada condomínio.
12. **Reposição Operacional** restringe os itens ao mix oficial da unidade.
13. Ao salvar o Planograma, inclusões e exclusões vindas da base histórica passam a ser persistidas no `planograms` oficial.
14. Incremento de estoque continua garantindo o vínculo Produto × Condomínio antes da movimentação.
15. Corrigido o HTML para não possuir IDs duplicados.
16. Tabelas de Contagem, Gestão, Validades, CD e Planograma ficaram mais compactas, com rolagem explícita e melhor aproveitamento de telas menores.
17. Navegação/Dashboard da V3.40 foi preservada.

## Relação histórica incorporada
A referência foi reconstruída pelo cruzamento da coluna `Arquivos de origem` da consolidação de produtos com as bases de planograma anteriormente homologadas. O frontend cruza esses vínculos novamente com a Base Mestre existente em tempo de execução; portanto produtos descontinuados/ausentes da Base Mestre não são recriados automaticamente.

Em teste contra a carga inicial disponível (1.244 EANs), a referência resolveu produtos para todas as sete unidades: Jomar 535; Dom Vicente 824; Life Residence 965; Riviera Business & Mall 598; Ville de Leon 897; Luna Bella 636; Luna Itaipava 641. Esses números são interseções com a Base Mestre de teste, não metas fixas — a quantidade exibida acompanha a Base Mestre real publicada.

## Bateria de validação
**28/28 verificações aprovadas**, incluindo:
- sintaxe JavaScript do frontend;
- sintaxe JavaScript do Apps Script (parse);
- zero IDs HTML duplicados;
- versão/Service Worker V3.41 consistentes;
- seed no cache offline;
- Dashboard lateral e botão Dashboard superior;
- aba Condomínios por produto presente;
- vínculo canônico em Gestão, Contagem, Validades, Planograma, Cadastro, Compra Semanal e Reposição;
- exclusão explícita do Planograma prevalecendo sobre fallback;
- Incremento de Estoque garantindo vínculo;
- Movimentação CD em tabela por colunas;
- rolagem e densidade visual compacta;
- sete condomínios com relações históricas não vazias;
- ausência de EAN duplicado dentro de cada relação histórica.

## Implantação
1. Publicar **todo** o ZIP GitHub V3.41, inclusive `seed-planograms-v3.41.json`.
2. Substituir/publicar o Apps Script V3.41.
3. Atualizar a implantação do Apps Script mantendo a URL `/exec` configurada no frontend.
4. Fazer atualização forçada/limpeza de cache do PWA para remover o Service Worker anterior.
5. Confirmar no topo `v3.41.0`.

## Smoke test no ambiente publicado
Após o deploy, confirmar visualmente:
- Jomar/Ville/Luna apresentam produtos em Gestão de Estoque;
- as mesmas unidades apresentam a mesma relação na Contagem Física e em Validades;
- Produtos → Planograma mostra seleção diferente para cada condomínio;
- Condomínios por produto mostra as unidades correspondentes ao EAN selecionado;
- salvar/desmarcar um produto no Planograma persiste após recarregar;
- filtros de Compras respeitam o mix por condomínio;
- câmera, permissões do navegador e latência real do Apps Script continuam dependendo do ambiente publicado/hardware.
