# OKEO Core V3.6 — FINAL

Versão final do núcleo operacional de Estoque & Compras, após homologação funcional automatizada e testes de carga.

## Homologação funcional
Foram executados 46 testes de interface e fluxo em navegador automatizado, com 46 aprovações e 0 falhas. Foram validados autenticação, senha errada/correta, todas as abas, produtos/aliases/EAN, unidades, inventário, câmera para EAN, foto/câmera para validade, lotes, transferências, NF XML, compras, Ponto de Controle, grupos, Demanda, vendas, reposição, perfis, permissões, backups, snapshots externos, autoteste, integridade e auditoria.

Também passaram smoke tests de autenticação/permissões do backend, segurança, geração de relatórios/PDF e auditoria estática frontend ↔ backend ↔ IndexedDB.

## Performance medida
Cenário de 2.000 produtos, 30 unidades e aproximadamente 62.000 saldos:
- Estoque de uma unidade / 2.000 produtos: ~47 ms
- Produtos / 2.000 produtos: ~7 ms
- Demanda de uma unidade / 2.000 produtos: ~274 ms
- Reposição 1 unidade / 2.000 produtos: ~113 ms
- Reposição 5 unidades / ~5.864 necessidades: ~377 ms
- Dashboard com ~62.000 saldos: ~7 ms

Com 250.000 registros históricos de venda:
- Demanda de uma unidade: ~291 ms
- Recalcular Demanda operacional de 5 unidades: ~383 ms

## Arquitetura
Analytics e Financeiro permanecem isolados do Core. Eles recebem snapshots somente-leitura e não participam do login, inventário, compras, estoque, lotes ou movimentações.

## Instalação
1. Substitua o Apps Script por `GoogleAppsScript_OKEO_CORE_V3_6_FINAL.gs`.
2. Execute `setupOkeoCoreV36`.
3. Atualize a implantação do Web App.
4. Confirme `/exec?action=status` com versão `3.6.0` e `authContract: OKEO_AUTH_V1`.
5. Publique TODO o conteúdo deste ZIP no GitHub Pages.
6. Faça Ctrl+F5.
7. Entre como Administrador.
8. Execute Configurações → Autoteste e Verificação de Integridade.

O cadastro de validade por câmera nesta versão captura/anexa a imagem pelo celular e registra lote/data informados. OCR automático da data de validade não é requisito para o funcionamento do Core e não bloqueia estoque/reposição.


## V3.7 — ajustes operacionais
- Central de Reposição: seleção de PDF por Ambos, Fornecedor ou Condomínio.
- Seletor de unidades fecha ao clicar fora.
- Movimentações: quantidades exclusivamente inteiras; decrementos registrados com sinal negativo.
- Base Histórica de Demanda: seleção simultânea de vários JSONs, consolidação por unidade/EAN e soma dos períodos históricos.


## V3.8 — fluxo de recebimento e ponto de controle
- Ponto de Controle registra data, hora e minuto da contagem e usa esse timestamp como marco inicial do novo ciclo.
- XML/NF importada gera tabela de conferência editável: EAN, produto, quantidade, custo, lote, validade e fornecedor.
- Compras possui opção “Receber tudo no CD e distribuir depois”.
- Movimentações exibe estoque do CD e sugere destinos por condomínio usando a Demanda Inteligente.


## V3.9 — cadastro assistido por EAN
- NF com EAN ainda não cadastrado oferece Cadastro/Completar produto diretamente da conferência.
- Cadastro assistido pré-preenche EAN, nome, fornecedor, custo/PC e demais dados disponíveis; os demais campos de-para permanecem abertos para completar.
- Campos operacionais baseados em EAN mostram automaticamente o nome cadastrado (e fornecedor quando disponível).
- EAN desconhecido em Estoque/Inventário, Compras, Movimentações, Validades, Ponto de Controle e consulta do CD oferece abertura imediata do Cadastro de Produto.


## V3.10 — ergonomia, Demanda e Usuários
- Espaçamento visual padronizado entre botões, linhas, tabelas e blocos.
- Quantidades operacionais usam números inteiros; campos de custo/preço usam 2 casas decimais.
- Importação da Base Histórica foi movida para a própria Demanda Inteligente.
- “Importar e calcular demanda” consolida vários arquivos e recalcula automaticamente.
- Botão de Demanda possui status de processamento/erro, evitando clique silencioso.
- Inventário e Ponto de Controle atualizam a demanda operacional da unidade após a contagem.
- Usuários agora aparecem em tabela de edição direta com nome, perfil, status, observação, nova senha e último acesso.


## V3.11 — correção da importação de Demanda
- Importador identifica arquivos ZIP/XLSX e informa claramente que devem ser convertidos para CSV ou JSON.
- Importação aceita vários JSON e CSV no mesmo lote.
- Um arquivo inválido não interrompe os demais.
- A base anterior só é substituída depois que existe ao menos um arquivo válido, evitando perda acidental.
- Mensagens mostram arquivos válidos, ignorados e registros não mapeados.
- Fonte geral aumentada em aproximadamente 1 px para melhorar legibilidade.

## V3.12 — Snapshot enxuto de Demanda
Os históricos são processados em memória. O Core persiste somente o snapshot consolidado Unidade+EAN e a demanda operacional. A base bruta não é armazenada. O snapshot é verificado antes da conclusão e são mantidos metadados do processamento.


## V3.13 — Gestão de Estoque e Movimentação CD
- Importação de Demanda aceita XLSX diretamente, além de CSV/JSON.
- Nova aba Gestão de Estoque: valor e quantidade total, CD, condomínios, SKUs e itens a vencer em 7 dias.
- Gestão de Estoque possui análise dos movimentos recentes e exportação CSV do relatório.
- “Movimentações” foi renomeada para “Ajuste de Estoque”.
- Nova aba Movimentação Estoque CD: valor/quantidade no CD, checklist pesquisável de produtos e sugestões de alocação pela Demanda Inteligente.
- O painel de sugestões do CD foi retirado do Ajuste de Estoque e reaproveitado na nova aba.

## V3.14 — Gestão de Estoque com Ruptura/Reposição
A Gestão de Estoque passa a exibir total de itens em Ruptura, total de itens em Reposição e quantidade total sugerida para abastecimento. O detalhamento por unidade também mostra esses três indicadores.


## V3.15 — Seletor de Produtos OKEO
Foi criado um componente único de pesquisa/checklist reutilizado em Inventário, Ponto de Controle, Compras, Ajuste de Estoque, Validades, Reposição, Demanda Inteligente e Gestão de Estoque.
A busca considera nome oficial, EAN, aliases, nome VM Pay, fornecedor, segmento e grupo.
Filtros rápidos: Todos, Com saldo, Ruptura, Reposição e Validade ≤ 7 dias.
Inclui Selecionar visíveis e Limpar seleção.
Na Gestão de Estoque, os cards Ruptura/Reposição/Validade passam a abrir diretamente a lista filtrada.

## V3.16 — Navegação corrigida e Controle de Estoque unificado
- Gestão de Estoque e Movimentação Estoque CD agora estão explicitamente no menu principal.
- Estoque/Inventário e Ponto de Controle foram unidos em Controle de Estoque.
- Controle de Estoque possui Contagem rápida e Ponto de Controle como modos internos.
- Movimentações foi renomeada para Ajuste de Estoque.

## V3.17 — homologação prática
- Seletores de produto efetivamente presentes no HTML.
- XLSX VM Pay: cabeçalho localizado dinamicamente após filtros; datas Excel convertidas; histórico mapeado por unidade e nome/alias do produto.
- Vendas aceita CSV e XLSX.
- Importação histórica calcula por semanas do período, salva snapshot compacto e descarta linhas brutas.
- Quantidades de reposição inteiras.

## V3.18 — correções encontradas na homologação
- Busca de Produtos/Grupos inclui aliases e VM Pay.
- Seletor Ruptura/Reposição usa a mesma lógica de grupos da Demanda.
- Filtro de produtos da Central de Reposição agora filtra a tabela de verdade e preserva os índices de edição.

## V3.18 — Homologação final para produção
- Suíte prática: 59/59 testes aprovados.
- Autoteste interno: 68/68.
- 37/37 arquivos XLSX reais do VM Pay processados pelo importador.
- CSV/JSON: aprovados.
- Backend: autenticação, perfis, permissões e migração de perfis antigos aprovados.
- Gestão de Estoque testada com ~60.000 saldos.
- Zero pageerror e zero console error na suíte prática.

## V3.19 — Correção de autenticação
- Corrigido login automático indevido quando "Manter conectado" não está marcado.
- Sessão temporária agora permanece somente em memória durante a página atual.
- Ao recarregar/abrir novamente sem "Manter conectado", o sistema exige usuário, senha e clique em "Entrar no sistema".
- Login automático é permitido somente quando "Manter conectado" foi marcado explicitamente.
- Sessões temporárias antigas gravadas por versões anteriores são apagadas no início.

## V3.20 — Controle de Estoque operacional
- Menu lateral com ícones mais largos, maior espaçamento e leitura melhor.
- “Ponto de Controle” passa a se chamar “Contagem de Estoque Física”.
- A Contagem de Estoque Física carrega a lista de produtos existentes na unidade selecionada.
- Cada produto mostra saldo previsto, observado e diferença.
- Quantidade observada pode ser digitada ou ajustada com +/−.
- Leitura por câmera/EAN identifica o produto e soma 1 na contagem observada.
- EAN novo oferece abertura imediata do Cadastro de Produto.
- “Contagem rápida” passa a se chamar “Incremento de Estoque”.
- Incremento de Estoque adiciona manualmente quantidade positiva ao saldo, registra movimento e lote sem validade conhecida, sem substituir o saldo existente.

## V3.21 — Fluxo de controle simplificado
- Controle de Estoque fica exclusivamente com Contagem de Estoque Física.
- A unidade selecionada carrega uma lista pesquisável/checklist dos produtos já associados via estoque/demanda.
- A câmera localiza o item na lista e soma 1 à quantidade observada; EAN novo direciona ao cadastro.
- Incremento Manual de Estoque foi movido para Produtos, com lista/checklist, câmera, unidade, quantidade e observação.
- Movimentação Estoque CD mantém a lista completa de produtos com saldo, pesquisa e checklist sempre visíveis.

## V3.22 — Base Mestre e Planograma por Unidade
- Produtos foi separado em três abas: Cadastro de Produtos Novos, Incremento Manual de Estoque e Planograma por Condomínio/CD.
- A Base Mestre continua sendo o catálogo único de produtos.
- Planograma usa toda a Base Mestre em pesquisa/checklist e salva a seleção por unidade.
- Contagem de Estoque Física passa a listar exatamente os produtos do planograma da unidade.
- EAN bipado é consultado na Base Mestre; produto existente fora do planograma pode ser adicionado à unidade no momento da leitura.
- Produto inexistente na Base Mestre continua direcionando ao Cadastro de Produto.
- Incremento Manual pode mostrar somente o planograma da unidade ou toda a Base Mestre.

## V3.23 — Planograma definitivo
- Incremento Manual removido.
- Produtos possui Cadastro de Produtos Novos e Planograma.
- Planograma editável por condomínio, por produto ou por importação.
- Importação cruza por EAN e, se necessário, nome/alias normalizado.

### Revisão de fechamento V3.23
- Autoteste atualizado para exigir backend 3.23.0.
- Snapshot da Demanda registra versão 3.23.0.
- Backup identificado como V3.23.
- Importador XLSX do Planograma localiza cabeçalhos fora da primeira linha e reconhece `Código de barras` + `Nome`, compatível com exportações reais de produtos.

## V3.24 — Navegação corrigida e novo alerta de demanda
- Corrigido `bind()` que ainda apontava para campos antigos removidos; isso interrompia eventos de Planograma e menu do usuário.
- Planograma volta a abrir pelo botão.
- Menu do usuário no topo exibe a opção Sair e fecha ao clicar fora.
- Nível de Alerta = 30% da demanda semanal média.
- Resultado do Nível de Alerta é sempre arredondado para cima com `Math.ceil`.
- Estoque Ideal permanece em 100% da demanda semanal média, também inteiro para cima.

## V3.25 — Correção operacional
- Contagem Física lista toda a Base Mestre, com pesquisa, checklist, +/− e digitação manual por produto.
- Produtos do planograma/saldo aparecem pré-selecionados; os demais continuam disponíveis para rápida inclusão.
- Movimentação de Estoque CD lista toda a Base Mestre, inclusive itens com saldo zero.
- Sugestão do CD exibe todos os condomínios; unidade sem necessidade recebe 0.
- Saldo excedente após atender necessidades aparece como FICAR NO CD.
- Central de Reposição renomeada para Relatório de Reposição.
- Validades passa a aceitar foto da validade e foto do produto e deixa explícito que não incrementa estoque.
- Nível de Alerta reforçado em 30% da demanda semanal, sempre arredondado para cima.
- Botões do Planograma possuem acionamento direto adicional.
- Service Worker força ativação da versão nova para reduzir permanência de frontend antigo em cache.

## V3.26 — Validade vinculada ao estoque real
- Validade nunca cria estoque.
- Estoque físico zero bloqueia cadastro de validade e direciona para Contagem de Estoque Física.
- Mercadoria prevista/em trânsito não é tratada como estoque físico; validade fica pendente até o recebimento.
- Validade manual só classifica quantidade física já existente e ainda sem validade conhecida.
- Relatório de Validades mostra, por condomínio/CD, SKUs e unidades sem validade registrada.
- Funções FEFO adicionadas para consumo/transferência de lotes pela validade mais próxima.

## V3.27 — Homologação e correções de fechamento
- Corrigidas duas fórmulas internas que ainda calculavam o Nível de Alerta em 50%; todo o Core passa a usar teto de 30% da demanda semanal média.
- Removidos textos residuais de Incremento de Estoque do Controle de Estoque.
- Relatório de Validades passa a exibir também quantidade em trânsito, sem somá-la ao estoque físico.
- Detecção de mercadoria em trânsito consulta Reposições aprovadas/em andamento.
- Fotos da validade e do produto permanecem locais e não são enviadas como base64 na sincronização central.
- Transferências manuais e por Relatório de Reposição usam explicitamente FEFO.
- Build stamp visível para facilitar diagnóstico de cache/versão publicada.

- Validade em estoques migrados sem lotes cria apenas metadado SEM VALIDADE até o saldo físico atual; não incrementa estoque.

- Autoteste agora verifica Planograma, cobertura de validade, FEFO e regra matemática de 30%/100%.
- Integridade detecta Planogramas órfãos e snapshots de demanda ainda gravados com regras antigas.

## V3.28
- Gestão de Estoque informa data/hora da última importação de vendas.
- Histórico de posições de estoque guarda a posição anterior antes de operações relevantes e mantém as 60 mais recentes.
- Responsável da Contagem Física usa usuários/perfis cadastrados.
- Base Mestre pode ser exportada para CSV, editada e reimportada por EAN em XLSX/CSV/JSON.
- A reimportação mostra prévia com NOVO / ALTERAR / SEM ALTERAÇÃO antes de aplicar.
