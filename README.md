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

## V3.29
- Contagem manual e lista/checklist usam o mesmo registro.
- Alterar em cima atualiza a linha; alterar +/−/digitação na linha atualiza os campos superiores.
- Câmera usa o mesmo registro.
- Histórico de estoque guarda posição completa por unidade/produto/EAN/quantidade/custo/valor.
- Histórico exportável em CSV para Excel.

## V3.30
- Gestão de Estoque: Controle Geral + Controle de Estoque por Condomínio.
- Controle por Condomínio usa somente produtos do planograma e mostra estoque atual, pico, recomendado, alerta e status.
- Validades exibe somente produtos do planograma da unidade selecionada.
- Base Mestre: exportação CSV/XLSX e importação XLSX/CSV/JSON.
- Exportação do histórico corrigida para função global.


## V3.31 — Controle por condomínio operacional
- Controle de Estoque por Condomínio passa a exibir todos os produtos pertinentes à unidade (planograma, saldo físico ou demanda vinculada).
- Exibe quantidade atual, existência de validade cadastrada, próxima validade, status de abastecimento e quantidade sugerida para reposição.
- Filtros combináveis por pesquisa, estoque, validade e status de abastecimento.
- Resumo imediato de produtos pertinentes, produtos com/sem validade e itens que precisam abastecimento/estão em ruptura.
- Itens com saldo/demanda mas fora do planograma permanecem visíveis e sinalizados para evitar estoque oculto.


## V3.32 — Contagem, listas em tabela e reposição por checklist
- “Controle de Estoque” renomeado na interface para “Contagem de Estoque”. A chave interna `controlstock` foi preservada para não quebrar perfis e permissões existentes.
- Integração bidirecional reforçada: lançamento manual superior, digitação na tabela, botões +/−, câmera e editor do ponto de controle passam a refletir o mesmo `controlPointItem`.
- Seletor reutilizável de produtos alterado de cartões/linhas soltas para tabela com Produto, EAN, fornecedor, segmento, estoque e status.
- Validades → Produtos do planograma da unidade agora retorna tabela com estoque atual, validade cadastrada, próxima validade e ação.
- Relatório de Reposição agora possui checklist operacional: itens podem ser desmarcados/retirados e restaurados antes da aprovação. Itens retirados não entram na aprovação nem nos PDFs e são auditados.
- Rascunho de reposição ganhou busca e filtros por selecionados, retirados, origem CD e compra.
- A prioridade CD → fornecedor foi preservada e explicitada: o saldo disponível no CD é consumido primeiro; somente a falta residual vira sugestão de compra.
- Resumo da reposição diferencia itens ativos, origem CD, compra e removidos.


## V3.33 — Compras semanais preventivas e Reposição dentro de Compras
- O módulo Compras passa a abrir pelo Planejamento de Compra Semanal.
- Fornecedores são tratados, por padrão, com horizonte de 7 dias entre entregas.
- Compra mínima para evitar ruptura = demanda do horizonte - estoque projetado - quantidade disponível no CD.
- Compra recomendada = demanda do horizonte + nível de alerta - estoque projetado - quantidade disponível no CD.
- Produtos que estão com status OK na reposição imediata podem aparecer como compra preventiva da semana.
- O CD continua sendo consumido primeiro antes de sugerir compra externa.
- Relatório por condomínio e consolidado por produto/fornecedor, com exportação CSV compatível com Excel.
- Compras ganhou acesso interno ao resumo da Reposição Operacional, mantendo o checklist completo existente.
- Exemplo validado: estoque 10, média semanal 40, alerta 4, CD 0 -> compra mínima 30 e recomendada 34.


## V3.34 — DE/PARA Produto × Condomínio e lista oficial por unidade
- Gestão de Estoque por Condomínio passa a usar o planograma/cadastro Produto × Condomínio como lista oficial.
- Ao selecionar uma unidade, a tabela exibe os produtos cadastrados para aquela unidade com quantidade, validade, status de abastecimento e quantidade sugerida.
- Se a unidade não tiver lista cadastrada, a tela informa claramente a ausência e oferece importação DE/PARA.
- Nova importação DE/PARA em XLSX/CSV/JSON, preferencialmente com colunas Condomínio, Produto e EAN.
- Cruzamento de condomínio por nome/alias e de produto por EAN; nome/alias do produto é fallback.
- Quando o arquivo não possui coluna de condomínio, pode-se selecionar uma unidade padrão.
- Modos de importação: adicionar/atualizar vínculos ou substituir a lista das unidades presentes no arquivo.
- Prévia antes de aplicar informa vínculos válidos, unidades não encontradas e produtos não encontrados.
- Modelo CSV pode ser baixado diretamente pela tela.
- Saldos/demandas existentes fora da lista oficial são sinalizados como inconsistência, sem substituir silenciosamente o cadastro do condomínio.
- Como os módulos de Contagem, Validades, Reposição, Compras e Gestão usam `planograms`, o DE/PARA aplicado passa a ser a referência compartilhada entre eles.


## V3.35 — filtros, reposição incorporada e contagem por condomínio
- Contagem usa exclusivamente o planograma da unidade e mostra o total real por condomínio.
- Unidade sem planograma exibe aviso para importar/enviar DE/PARA Produto × Condomínio.
- Compra semanal: condomínio e fornecedor em pesquisa + checklist multiseleção.
- Relatório de Reposição incorporado integralmente dentro de Compras, sem link externo.


## V3.36 — Produto novo com vínculo direto aos condomínios
- Cadastro de Produto Novo ganhou pesquisa e checklist dos condomínios ativos.
- Ao salvar, o produto é gravado uma única vez na Base Mestre e os condomínios marcados são gravados no Planograma oficial (`planograms`).
- Ao editar produto existente, os condomínios já vinculados aparecem previamente marcados e podem ser atualizados.
- A seleção alimenta automaticamente Contagem, Gestão de Estoque, Validades, Reposição e Compras, sem base paralela.
- CD permanece separado do checklist de condomínios.

## V3.38 — integração única Produto × Condomínio + Fornecedores
- `planograms` passa a fazer parte da sincronização CORE: Gestão de Estoque e Contagem Física recebem os vínculos Produto × Condomínio já salvos na Base Central ao entrar no sistema.
- Relação canônica Produto × Condomínio reconcilia Planograma, `products.unitIds`, estoque e demanda; vínculos válidos ausentes são reparados automaticamente.
- Gestão de Estoque, Contagem Física, Validades, Reposição e Compras usam a mesma função de vínculo por unidade.
- Incremento de Estoque exige EAN existente na Base Mestre e, quando lançado em condomínio, garante automaticamente o vínculo Produto × Condomínio no Planograma e em `products.unitIds`.
- Seletor de condomínios do Cadastro de Produto ficou recolhido por padrão, com pesquisa + checklist; abre ao clicar e fecha ao clicar fora.
- Filtros de condomínios e fornecedores da Compra Semanal ficaram recolhidos/expansíveis e fecham ao clicar fora.
- “Unidades” foi renomeado para **Condomínios e Fornecedores**, com abas internas.
- Aba Fornecedores permite cadastrar/editar fornecedores, filtrar fornecedor, visualizar os produtos atendidos e marcar/desmarcar produtos da Base Mestre. O vínculo é salvo em `supplierOffers`, permitindo vários fornecedores por produto sem apagar o fornecedor principal.

## V3.38 — Homologação, desempenho e integridade
- Reconciliação Produto × Condomínio otimizada: vínculos já corretos não geram mais leituras/gravações redundantes por produto.
- Gestão de Estoque e Contagem Física continuam usando a mesma fonte canônica de produtos por unidade.
- Incremento de estoque garante o vínculo do produto com o condomínio antes de alterar o saldo.
- Parser CSV da Base Mestre e parser do DE/PARA foram separados, removendo declaração duplicada.
- Backend operacional identificado como 3.38.0, mantendo o mesmo contrato de dados e stores das versões anteriores.
- Stores críticas `planograms`, `suppliers` e `supplierOffers` confirmadas na sincronização frontend/backend.
- Validação estrutural, regressão e carga concluídas antes do empacotamento final.

## V3.39 — Correção estrutural de carga por condomínio
- Migração força recarga integral de Produtos, Unidades, Planogramas, Estoque, Demanda, Fornecedores e vínculos Fornecedor × Produto, evitando perda histórica por cursor de sincronização de versões anteriores.
- Gestão de Estoque e Contagem Física usam a mesma relação Produto × Condomínio e fazem recuperação automática se uma unidade abrir com 0 produtos.
- Registro de estoque com quantidade zero também comprova vínculo Produto × Condomínio.
- CD usa toda a Base Mestre como catálogo disponível.
- Checklists de condomínios e fornecedores são repopulados antes de abrir.
- Catálogo de fornecedores é reconciliado a partir de cadastro, Base Mestre, vínculos, compras e notas.
- Cadastro de fornecedor permite selecionar produtos da Base Mestre antes de salvar.
- Movimentação de Estoque CD passa a exibir Produto, EAN, Qtd., custo e valor em colunas.
- Backend permite persistência de `planograms` pelos módulos operacionais autorizados.
