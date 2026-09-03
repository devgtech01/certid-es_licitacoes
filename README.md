# Emissão de Certidões

Informe o CNPJ e receba as certidões dos órgãos públicos em PDF, organizadas
numa pasta por CNPJ e data.

**Pela interface** (recomendado):

```bash
npm run web
```

Abre http://localhost:3000 no navegador: digite o CNPJ, escolha as certidões
e acompanhe o progresso. Quando um portal pedir captcha ou login, aparece uma
faixa amarela dizendo o que fazer.

**Pelo terminal:**

```bash
node src/cli.js --cnpj 19711011000108
```

Saída: `certidoes/<CNPJ>/<AAAA-MM-DD>/` com um PDF por certidão e um
`relatorio.json` com o que deu certo e o que falhou.

## Instalação

```bash
npm install
npx playwright install chromium
```

## Certidões cobertas

| id | Certidão | Órgão | Automática? |
|---|---|---|---|
| `federal` | Certidão de regularidade fiscal (tributos federais e dívida ativa) | RFB/PGFN | sim |
| `estadual` | Certidão negativa de débitos tributários | SEFAZ-BA | sim |
| `municipal` | Certidão de regularidade fiscal PJ | SEFAZ Salvador | captcha |
| `tjba` | Certidão 1º grau — recuperação judicial, falência, concordata | TJBA | captcha |
| `cndt` | Certidão negativa de débitos trabalhistas | TST | captcha |
| `tcu` | Certidão de licitantes inidôneos | TCU | sim |
| `sancionados` | Relatório de fornecedores sancionados | TJBA | sim |
| `caixa` | CRF/FGTS + consulta + histórico do empregador | Caixa | sim |
| `cgu` | Certidão negativa correcional — entes privados | CGU | login gov.br |

`node src/cli.js --listar` mostra essa lista atualizada.

## Certidão federal: reaproveita a válida

Se o CNPJ já tem uma certidão federal válida, o app **baixa a 2ª via dela** em
vez de emitir outra — é o mesmo documento. Só emite quando não há nenhuma
válida nos últimos 180 dias.

## Captcha e login: como funciona

Cinco portais são automáticos de ponta a ponta. Os outros quatro têm captcha
ou exigem conta gov.br — **o programa não resolve captcha**. Ele preenche
tudo, abre a janela do navegador, avisa no terminal o que falta fazer e
continua sozinho assim que detecta que você resolveu:

```
☛  AÇÃO NECESSÁRIA  CNDT: digite os caracteres do captcha na janela (tentativa 1/3)
   · Resolva na janela do navegador. O robô segue sozinho quando detectar o resultado.
   · Se ele não detectar, aperte ENTER aqui no terminal para forçar a continuação.
```

Na interface, isso vira uma faixa amarela com o botão "Já resolvi, continuar".

Se o captcha for recusado, o app **falha e avisa** — ele nunca salva um print
da tela fingindo que é a certidão.

O login da CGU fica salvo no perfil `.perfil-navegador/`: você entra uma vez
e as próximas execuções já começam autenticadas. O programa nunca digita senha.

## Uso

```bash
# só as que rodam sozinhas (sem janela, para agendar/automatizar)
node src/cli.js --cnpj 19711011000108 --auto --headless

# uma certidão específica
node src/cli.js --cnpj 19711011000108 --only estadual,tcu

# salvar em outra pasta
node src/cli.js --cnpj 19711011000108 --saida "C:\Certidoes"
```

| Opção | Efeito |
|---|---|
| `--cnpj <cnpj>` | CNPJ com ou sem pontuação |
| `--saida <pasta>` | pasta base (padrão `./certidoes`) |
| `--only <ids>` / `--pular <ids>` | filtra quais certidões emitir |
| `--auto` | pula as que exigem captcha/login |
| `--headless` | sem janela (exige `--auto`) |
| `--razao-social` / `--endereco` | sobrescreve os dados usados pelo TJBA |
| `--data-inicial` / `--data-final` | período do relatório de sancionados |

Código de saída: `0` tudo certo, `2` alguma certidão falhou.

## Razão social e endereço

O TJBA exige razão social e endereço além do CNPJ. O programa busca esses
dados sozinho (BrasilAPI → cnpj.ws → ReceitaWS). Se as três estiverem fora do
ar, use `--razao-social` e `--endereco`.

## Estrutura

```
src/emissor.js           motor: laço, retry, relatório (usado pelos dois)
src/cli.js               interface de terminal
src/servidor.js          servidor da interface web
src/web/index.html       a página da interface
src/contexto.js          helpers dados a cada módulo (baixar, PDF, captcha)
src/dadosEmpresa.js      razão social/endereço a partir do CNPJ
src/certidoes/NN-*.js    um módulo por certidão
tools/recon.js           dump dos formulários de todos os portais
tools/probe.js           sonda manual de um portal
tools/ver-pdf.js         renderiza os PDFs emitidos em PNG para conferência
```

Para adicionar uma certidão, crie `src/certidoes/10-nome.js` exportando
`{ id, nome, arquivo, url, humano, emitir(ctx) }` e registre em
`src/certidoes/index.js`.

## Depuração

```bash
# registra a tela no momento em que o robô passa a vez para você
CERTIDOES_DEBUG=1 node src/cli.js --cnpj 19711011000108 --only cndt

# encurta a espera humana (para testar só o preenchimento automático)
CERTIDOES_DEBUG=1 CERTIDOES_TIMEOUT_HUMANO=8000 node src/cli.js --cnpj 19711011000108 --only tjba

# confere visualmente os PDFs emitidos
node tools/ver-pdf.js "certidoes/19711011000108/2026-08-12"
```

Quando uma certidão falha, o programa salva `_erro <id>.png` na pasta de saída
com a tela do momento do erro.
