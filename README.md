# OKEO Estoque V1.5 — Grupos & Ruptura

## Regras da Demanda Inteligente
- Nível de Alerta = 50% da demanda semanal média, arredondado para cima.
- Estoque Ideal = 100% da demanda semanal média, arredondado para cima.
- Pico semanal é indicador histórico; não define automaticamente o Estoque Ideal.
- OK: saldo calculado acima do Nível de Alerta.
- REPOSIÇÃO: saldo > 0 e <= Nível de Alerta. Repor até Estoque Ideal.
- RUPTURA: saldo = 0.
- Eventos de ruptura são persistidos para análise futura de frequência/duração.

## Grupos
- Seleção múltipla de produtos.
- Criar grupos de produtos substituíveis.
- Adicionar vários produtos de uma vez ao grupo.
- Marcar produtos sem substituto como Individual.
- A Demanda Inteligente permanece bloqueada enquanto houver produto ativo sem classificação.
