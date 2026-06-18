// Token-level syntax highlighting via Prism — fully offline, no network.
// We highlight per diff line (the table renders one line per row), which is the
// standard diff-viewer tradeoff: multi-line constructs (heredocs, block strings)
// aren't tracked across rows, but that doesn't occur in these hunks.
import Prism from 'prismjs';

// Prism core already ships: markup (html/xml/svg), css, clike, javascript.
// Load a general-purpose set of additional grammars below. Import order matters:
// a grammar that extends another must be loaded AFTER its dependency.
import 'prismjs/components/prism-markup-templating'; // dep for php
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';        // extends c
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-kotlin';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-ruby';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-php';        // extends markup-templating
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-scss';       // extends css (core)
import 'prismjs/components/prism-jsx';        // extends javascript (core)
import 'prismjs/components/prism-typescript'; // extends javascript (core)
import 'prismjs/components/prism-tsx';        // extends jsx + typescript
import 'prismjs/components/prism-docker';
import 'prismjs/components/prism-diff';
import 'prismjs/components/prism-graphql';

// File extension (and a couple of extensionless names) -> Prism grammar key.
const BY_EXT = {
  rb: 'ruby', rake: 'ruby', gemspec: 'ruby',
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin', kts: 'kotlin',
  cs: 'csharp',
  c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp',
  php: 'php',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  sql: 'sql',
  yml: 'yaml', yaml: 'yaml',
  json: 'json',
  toml: 'toml',
  md: 'markdown', markdown: 'markdown',
  css: 'css', scss: 'scss',
  html: 'markup', htm: 'markup', xml: 'markup', svg: 'markup', vue: 'markup',
  dockerfile: 'docker',
  diff: 'diff', patch: 'diff',
  graphql: 'graphql', gql: 'graphql',
};

export function langForFile(file) {
  const ext = String(file).split('.').pop().toLowerCase();
  const lang = BY_EXT[ext];
  return lang && Prism.languages[lang] ? lang : null;
}

// Fenced-code-block tag (```ruby, ```ts, ```python …) -> grammar key, including
// common aliases. Unknown/absent tags return null so the block renders as plain
// (escaped) text.
const BY_TAG = {
  rb: 'ruby', ruby: 'ruby',
  py: 'python', python: 'python',
  go: 'go', golang: 'go',
  rs: 'rust', rust: 'rust',
  java: 'java',
  kt: 'kotlin', kotlin: 'kotlin',
  cs: 'csharp', csharp: 'csharp', 'c#': 'csharp',
  c: 'c', h: 'c',
  cpp: 'cpp', 'c++': 'cpp',
  php: 'php',
  js: 'javascript', javascript: 'javascript', mjs: 'javascript', cjs: 'javascript',
  jsx: 'jsx',
  ts: 'typescript', typescript: 'typescript',
  tsx: 'tsx',
  sh: 'bash', bash: 'bash', shell: 'bash', zsh: 'bash', console: 'bash',
  sql: 'sql',
  yml: 'yaml', yaml: 'yaml',
  json: 'json',
  toml: 'toml',
  md: 'markdown', markdown: 'markdown',
  css: 'css', scss: 'scss',
  html: 'markup', xml: 'markup', svg: 'markup',
  dockerfile: 'docker', docker: 'docker',
  diff: 'diff', patch: 'diff',
  graphql: 'graphql', gql: 'graphql',
};

export function langForTag(tag) {
  const lang = BY_TAG[String(tag || '').toLowerCase()];
  return lang && Prism.languages[lang] ? lang : null;
}

// Returns highlighted HTML (Prism escapes its input), or null when there's no
// grammar for this language — callers then fall back to a plain text node.
export function highlight(code, lang) {
  if (!lang || !code) return null;
  const grammar = Prism.languages[lang];
  if (!grammar) return null;
  return Prism.highlight(code, grammar, lang);
}
