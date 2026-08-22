# OKEO Estoque V1.4 — Base Mestre & Estoque

## Núcleo operacional
- Cadastro Mestre com Produto, Subproduto, Fornecedor, Segmento, Localização, PC, EAN, NCM e CEST.
- Base Mestre embarcada a partir da base fiscal final auditada.
- 1 cadastro por EAN; nomes duplicados da planilha não viram SKUs duplicados.
- Unidades dinâmicas: CD + condomínios/mercados atuais + novos mercados.
- Inventário físico por unidade.
- Entradas manuais e por NF com foto local, quantidade, preço pago, custo médio e valor do estoque.
- Transferências CD↔condomínio e condomínio↔condomínio, inclusive empréstimos/devoluções.
- Validades por unidade, EAN, quantidade, data e foto.
- Demanda Inteligente com estoque físico, mínimo, ideal, pico, média, vendas desde a base, incrementos, decrementos, saldo calculado e sugestão de reposição.
- Consolidado total (CD + mercados) e consolidado de mercados (sem CD).
- Estrutura preparada para VM Pay.

## Desempenho
- Lançamentos operacionais são locais e imediatos.
- Sync em lote e delta.
- Carga mestre usa `bulk_upsert` em blocos.
