# OKEO Core V3.43

Versão consolidada de vínculo Base Mestre × Condomínios, mantendo as correções de navegação da V3.40.

- Dashboard abre imediatamente após login.
- Botão Dashboard permanente no topo.
- Sincronização ocorre em segundo plano sem redirecionar a tela atual.
- Tela automática de primeiro acesso removida do fluxo normal.
- Mantidas as integrações Produto × Condomínio e Fornecedor × Produto da V3.39.


## V3.43 — homologação final e correções de fluxo
- Corrigida a relação Produto × Condomínio para que condomínios homologados usem o seed/planograma oficial como fonte principal, sem ampliar o mix por vínculos auxiliares antigos de estoque, demanda ou `unitIds`.
- Migração V3.43 desativa vínculos criados automaticamente por reconciliações antigas quando não pertencem ao mix oficial da unidade.
- Novos produtos e inclusões manuais continuam entrando normalmente pelo Planograma/Cadastro.
- Removida definitivamente a aba “Condomínios por produto”; “Produtos por condomínio” e “Importar base do condomínio” permanecem funcionais.
- Corrigida a alternância do Planograma após a remoção da aba antiga.
- Corrigido o Service Worker: cache agora é `okeo-core-v3-43-final`, evitando permanência de arquivos V3.41/V3.42.
- Sincronização em lote (`putMany`) aplicada às cargas grandes do IndexedDB.
- A carga crítica do login não baixa mais Compras/NFs completas; esses dados continuam carregados sob demanda no módulo de Compras.
- Reconciliação Fornecedor × Produto passa a gravar fornecedores/ofertas em lote.
- Exportação do relatório de diferenças de contagem respeita os filtros selecionados.
- Corrigido o nome do arquivo na metadata da última importação de vendas.
- Gestão de Estoque, Contagem Física, Validades, Compras e Planograma continuam usando a mesma relação canônica Produto × Condomínio.

### Implantação V3.43
Publique todos os arquivos do ZIP GitHub, incluindo `seed-planograms-v3.43.json`, e atualize também o Apps Script V3.43. Após publicar, faça atualização forçada do navegador/PWA para substituir o Service Worker anterior.
