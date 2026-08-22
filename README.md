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
