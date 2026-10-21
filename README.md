# Prumo — Gestão de estoque

[Site online](https://alexmanhes.github.io/prumo-estoque/)

Aplicação demonstrativa em português para produtos, fornecedores, entradas, saídas e alertas de estoque baixo. HTML, CSS e JavaScript, sem dependências de execução da interface.

## Funcionalidades

- Painel com saldo, valor estimado, alertas de reposição e últimas movimentações.
- Cadastro e edição de produtos: SKU único, categoria, unidade, custo, mínimo, localização e fornecedor principal.
- Cadastro e edição dos contatos de fornecedores.
- Entradas com fornecedor, quantidade, custo, data e documento de referência.
- Saídas com motivo e bloqueio de quantidade superior ao saldo disponível.
- Prévia do saldo antes de confirmar a operação.
- Alertas automáticos para saldo menor ou igual ao mínimo, incluindo estoque zerado.
- Histórico por produto e geral, com filtros e pesquisa.
- Estorno vinculado ao registro original e motivo obrigatório; registros não são apagados.
- Arquivamento de produtos somente com saldo zero, preservando seu histórico.
- Exportação dos dados locais em JSON.

## Consistência e rastreabilidade

O saldo é derivado do histórico: entradas somam e saídas subtraem. Cada movimento registra o nome, SKU e unidade do produto naquele momento, fornecedor, documento, motivo, data da ocorrência, data do registro e responsável demonstrativo. Edições de cadastro não reescrevem esses registros.

As quantidades são inteiras. Os custos são armazenados em centavos inteiros. O valor do painel é uma estimativa de saldo × custo cadastrado, sem cálculo contábil de custo médio ou FIFO. Unidades movimentadas incluem estornos como movimentos opostos. O mês é calculado no horário de São Paulo.

SKU e unidade ficam fixos após a primeira movimentação. O modelo impede saldo negativo, estorno duplicado e vínculos inválidos. Uma saída estornada devolve unidades; uma entrada só pode ser estornada se ainda houver saldo suficiente. Um estorno não pode ser estornado novamente.

O salvamento compara a cópia carregada com o armazenamento atual e exige recarga se outra aba tiver atualizado os dados. Uma falha ao salvar preserva os registros anteriores e mantém o formulário para nova tentativa.

## GitHub Pages

Publicado a partir da branch `main`, pasta `/(root)`. Arquivos estáticos, sem instalação ou compilação.

## Dados e limites

Os exemplos são fictícios. Esta é uma demonstração local, sem autenticação, banco compartilhado ou sincronização entre usuários e dispositivos. Os dados são salvos no navegador de cada visitante. Limpar o armazenamento remove os cadastros e movimentações locais. O nome Alex Sander representa um operador de exemplo, sem comprovação de identidade. Para uma operação real, as transações e permissões devem ser impostas por um servidor autenticado.

A exportação guarda uma cópia JSON; esta versão não tem interface de importação. Nenhum cadastro ou movimento é enviado a um servidor pela aplicação estática.

## Executar e verificar

```sh
node serve.cjs
```

Abra http://127.0.0.1:8793/.

```sh
node --check js/app.js
node tests/model.cjs
```

Os testes validam saldos, imutabilidade, SKUs, fornecedores, custos, datas, arquivamento, estornos e recarga dos dados.

## Organização

```text
index.html       Estrutura da interface
css/styles.css   Tema e estilos responsivos
js/model.js      Regras de negócio e dados fictícios
js/app.js        Interface e persistência local
tests/model.cjs       Testes de consistência
serve.cjs             Servidor de prévia local
```
