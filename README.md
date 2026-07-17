# MLensIT

[![npm version](https://img.shields.io/npm/v/%40mit-0044%2Fmlensit.svg)](https://www.npmjs.com/package/@mit-0044/mlensit)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/mit-0044/mlensit/blob/main/LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)

**MLensIT** is an offline Static Code Intelligence Platform for TypeScript/JavaScript. It parses your codebase, builds a structural understanding of it (symbols, dependencies, call graph), generates and runs tests, and produces actionable reports — entirely through static analysis.

No network calls, no AI inference, no telemetry: every result is deterministic and reproducible from your source tree alone.

Full project docs and source live at [github.com/mit-0044/mlensit](https://github.com/mit-0044/mlensit).

## Features

- **Static analysis** — cyclomatic complexity hotspots, duplicate code, dead code, code smells (long methods, deep nesting, large classes), and a transparent 0–100 architecture score.
- **Test generation** — Vitest tests for functions, React/React Native components, custom hooks, and service modules, generated from static analysis.
- **Test execution** — runs generated tests via your project's own Vitest, measures coverage, and supports `--watch` mode that reruns only the tests affected by what changed.
- **Reporting** — console, JSON, Markdown, and HTML reports, plus a local interactive dashboard `mlensit report` opens immediately with live progress as the pipeline runs.
- **Plugins** — extend `analyze` with third-party `AnalyzerPlugin`s (e.g. `@mlensit/react`) without forking MLensIT.
- **Optional AI suggestions** — `@mlensit/ai` is an opt-in plugin that uses your own API key to add one-sentence refactor suggestions to the highest-complexity functions. It never runs unless you declare it, and no key is ever shipped with MLensIT.

## Installation

```bash
npm install -g @mit-0044/mlensit
```

Or run without installing:

```bash
npx @mit-0044/mlensit analyze .
```

Requires Node.js `>=18`. The package is a single self-contained bundle — no extra dependencies are installed alongside it.

## Quick Start

Run from your project's root (`path` defaults to `.`):

```bash
cd my-project
mlensit analyze     # scan → build symbol/dependency/call graph → print diagnostics
mlensit generate    # analyze, then generate Vitest tests from the graph
mlensit test        # analyze, generate, persist, and run the tests
mlensit report      # full pipeline — dashboard URL printed immediately, live progress in browser
```

Example output:

```
$ mlensit analyze
Analyzing .
Scanning .
Detected typescript, npm, framework: none, tests: vitest
Analysis of . completed
Found 3 diagnostic(s)
Analyzed 42 file(s), 118 symbol(s), 67 import edge(s), 203 call edge(s)
Architecture score: 94/100 (avg. complexity 2.1, max complexity 11)
Exported symbol 'legacyHelper' is not used by any other analyzed file (src/utils/legacy.ts)
'processOrder' has cyclomatic complexity 11 (threshold: 10) — consider refactoring (src/orders/process.ts)
'Form' takes 9 props (threshold: 8) — consider grouping them into a single props object (src/components/Form.tsx)
```

## CLI Reference

Every command accepts an optional `[path]` argument (the project to operate on), defaulting to `.`.

| Command | Description |
| ------- | ----------- |
| `mlensit analyze [path]` | Build the symbol/dependency/call graph; print diagnostics and architecture score. |
| `mlensit analyze [path] --ai-provider <provider> --ai-key <key>` | Same, plus AI-powered refactor suggestions on the highest-complexity functions (`groq` \| `openai` \| `gemini`). |
| `mlensit generate [path]` | Run `analyze`, then generate Vitest tests from the graph. |
| `mlensit test [path]` | Run `generate`, then persist and execute the generated tests. |
| `mlensit test [path] --coverage` | Also measure coverage and list files with no generated tests. |
| `mlensit test [path] --watch` | Rerun only the tests affected by changed files until interrupted (`Ctrl+C`). |
| `mlensit report [path]` | Full pipeline — dashboard URL printed immediately, live progress in browser, then the final interactive dashboard. Also writes console, JSON, Markdown, and HTML reports to `<path>/.mlensit/`. |
| `mlensit --help` | List all commands and options. |
| `mlensit --version` | Print the installed version. |

## Configuration & Plugins

Declare plugins in an `mlensit.config.json` at your project root:

```json
{
  "plugins": ["@mlensit/react", "./local-plugin.mjs"]
}
```

Each entry is either a bare package name (resolved from your project's `node_modules`) or a `.`/`/`-prefixed path (resolved relative to the project root). A plugin that fails to load or throws is reported as a warning and never aborts the run.

### AI Suggestions (`@mlensit/ai`)

`@mlensit/ai` is an optional, opt-in plugin that asks a bring-your-own-key provider for one-sentence refactor suggestions on your project's highest-complexity functions. It never runs unless declared, and no API key is ever shipped with MLensIT.

**Via `mlensit.config.json` + environment variables:**

```json
{ "plugins": ["@mlensit/ai"] }
```

```bash
export MLENSIT_AI_PROVIDER=groq            # groq | openai | gemini
export MLENSIT_GROQ_API_KEY=your-key-here  # or MLENSIT_OPENAI_API_KEY / MLENSIT_GEMINI_API_KEY
mlensit analyze
```

**Via CLI flags (no config file change needed):**

```bash
mlensit analyze --ai-provider groq --ai-key your-key-here
```

With no provider configured, every command stays fully offline and deterministic.

## License

[MIT](https://github.com/mit-0044/mlensit/blob/main/LICENSE)
