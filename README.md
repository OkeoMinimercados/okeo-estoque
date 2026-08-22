# OKEO Estoque V1.4.1 — Aliases & VM Pay

- 1245 SKUs únicos por EAN.
- 169 EANs possuem mais de uma nomenclatura na planilha final.
- 189 nomes alternativos preservados como aliases.
- Mesmo EAN continua sendo um único produto para estoque, vendas, custo e demanda.
- Campo `vmPayName` preparado para registrar a nomenclatura oficial observada na VM Pay.
- Limpeza segura apenas dos dois produtos de teste históricos conhecidos; produtos futuros cadastrados manualmente não são apagados.
- Base fiscal/cadastral oficial continua preservando Produto, Subproduto, Fornecedor, Segmento, Localização, PC, EAN, NCM e CEST.
