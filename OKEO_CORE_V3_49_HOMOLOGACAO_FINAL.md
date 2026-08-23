# OKEO V3.52 — Homologação Final Local

## Resultado

**99/99 verificações aprovadas.** Backend Apps Script: OK na validação sintática.

## Falha raiz corrigida

Foi identificado que `bind()` ainda tentava ligar diretamente controles antigos de Reposição (`repDraft`, `repApprove`, `repUnitsToggle` e outros) que já não existiam no HTML. Isso gerava exceção durante a inicialização e impedia que handlers posteriores fossem instalados. Essa única falha explicava diversos sintomas simultâneos: abas de Gestão vazias, pesquisas sem filtrar e listas de fornecedores/produtos sem atualizar. Na V3.52 todos esses controles legados são opcionais/guardados e os filtros críticos possuem uma camada independente de binding.

## Correções principais

- Gestão de Estoque: Controle Geral, Gestão por Condomínio e Análise de Divergências agora são painéis irmãos, com troca forçada de `display` e tratamento de erro visível.
- Todos os campos de pesquisa/filtro críticos foram conferidos e possuem binding robusto independente.
- Produtos por fornecedor reconcilia a Base Mestre com fornecedores e `supplierOffers` antes de listar.
- Um produto permanece com somente um fornecedor ativo. Trocar fornecedor desativa o vínculo antigo e atualiza a Base Mestre.
- Renomear fornecedor propaga o novo nome para os produtos e compras operacionais pendentes; documentos históricos concluídos permanecem como evidência histórica.
- Movimentação de Estoque CD ganhou a aba **Mercadorias aguardando recebimento**, alimentada pelos itens da Compra Semanal marcados como **Passar pelo CD**.
- Recebimento no CD exige validade; depois o item fica reservado para o condomínio. Despachar não altera o estoque do condomínio. Somente confirmar o abastecimento incrementa o estoque.
- Itens despachados e não abastecidos permanecem pendentes.
- Validades permite registrar duas validades/lotes no mesmo lançamento. O modelo de `lots` suporta múltiplos lotes/datas por Produto × Unidade e a análise lista cada lote separadamente.
- A análise visual de mercadoria em trânsito permanece removida.
- Melhorias anteriores de Base Mestre × Produto × Condomínio, Compra Semanal e Produtos por fornecedor foram preservadas.

## Testes executados

- Inicialização e regressão do `bind()` com controles removidos.
- Estrutura HTML, IDs duplicados e sintaxe JavaScript.
- Service Worker e arquivos versionados V3.52.
- 18 pesquisas de texto e 13 filtros/selects críticos com ligação efetiva.
- Gestão por Condomínio e Divergências.
- Fornecedor único, troca de fornecedor, renomeação e propagação.
- Produtos por fornecedor e Produtos atendidos pelo fornecedor.
- Compra Semanal: Imediato × CD.
- CD: pré-registro, recebimento, validade, reserva e despacho.
- Confirmação do abastecimento e atualização do estoque somente na etapa final.
- Duas validades distintas para o mesmo produto.
- Simulações de estado de ponta a ponta para fornecedor e CD.
- Teste sintético de filtro em 300 mil linhas: **22.25 ms**.
- Construção de mapa fornecedor/produto em 300 mil linhas: **116.95 ms**.

## Limitação de homologação

O Chromium headless deste ambiente não inicializa corretamente por dependências de DBus, portanto não é possível afirmar que câmera, IndexedDB real do navegador, Service Worker publicado e latência real do Apps Script foram homologados aqui. A V3.52 passou na bateria local de código, estrutura, regressão, estado e performance, mas ainda deve receber um smoke test no endereço publicado após o deploy.
