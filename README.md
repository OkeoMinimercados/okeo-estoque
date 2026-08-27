# OKEO Gestão 5.3 Stable

Release de estabilização do transporte GitHub Pages ↔ Google Apps Script.

O frontend preserva o IndexedDB existente no domínio GitHub. A comunicação com o
Apps Script não depende de iframe nem de CORS tradicional: leituras usam JSONP e
escritas/login usam POST no-cors + retorno assíncrono por requestId.

Ver OKEO_5_3_0_RELATORIO_FINAL.md.
