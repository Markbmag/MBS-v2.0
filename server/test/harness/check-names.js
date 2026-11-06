#!/usr/bin/env node
/*
 * Static check: reports every identifier that is used but not defined anywhere
 * it could be seen from (like ESLint's no-undef), so that a missing import after
 * moving code between files is found even in code the recorder never runs.
 *
 *   node --expose-internals test/harness/check-names.js file.js [more.js ...]
 *
 * Uses the JavaScript parser bundled inside Node (acorn), so nothing has to be
 * installed. Exit code 1 if anything is undefined.
 *
 * Simplification: a let/const declared anywhere inside a function counts for the
 * whole function. This can hide a rare mistake, never invent one.
 */
'use strict';
const fs = require('fs');
const acorn = require('internal/deps/acorn/acorn/dist/acorn');

const GLOBALS = new Set([
  ...Object.getOwnPropertyNames(globalThis),
  'require', 'module', 'exports', '__dirname', '__filename', 'arguments', 'undefined',
]);

const isFn = (n) => n && /^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(n.type);

function patternNames(p, out) {
  if (!p) return out;
  switch (p.type) {
    case 'Identifier': out.add(p.name); break;
    case 'ObjectPattern': p.properties.forEach((x) => patternNames(x.type === 'RestElement' ? x.argument : x.value, out)); break;
    case 'ArrayPattern': p.elements.forEach((x) => patternNames(x, out)); break;
    case 'AssignmentPattern': patternNames(p.left, out); break;
    case 'RestElement': patternNames(p.argument, out); break;
    default: break;
  }
  return out;
}

// Names declared directly in this function/program body (not in nested functions).
function declaredIn(body) {
  const out = new Set();
  (function visit(n) {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'VariableDeclaration') n.declarations.forEach((d) => patternNames(d.id, out));
    if (n.type === 'FunctionDeclaration' && n.id) { out.add(n.id.name); return; }
    if (n.type === 'ClassDeclaration' && n.id) out.add(n.id.name);
    if (n.type === 'CatchClause' && n.param) patternNames(n.param, out);
    if (isFn(n)) return;
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach(visit); else if (v && typeof v.type === 'string') visit(v);
    }
  })(body);
  return out;
}

function check(file) {
  const src = fs.readFileSync(file, 'utf8');
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', locations: true, allowHashBang: true, allowReturnOutsideFunction: true });
  const problems = [];
  const scopes = [declaredIn(ast)];
  const defined = (name) => GLOBALS.has(name) || scopes.some((s) => s.has(name));

  // Walk the default values inside a binding pattern (the bound names themselves are not uses).
  function walkPatternDefaults(p) {
    if (!p) return;
    if (p.type === 'AssignmentPattern') { walkPatternDefaults(p.left); walk(p.right, p); }
    else if (p.type === 'ObjectPattern') p.properties.forEach((x) => { if (x.type === 'RestElement') walkPatternDefaults(x.argument); else { if (x.computed) walk(x.key, x); walkPatternDefaults(x.value); } });
    else if (p.type === 'ArrayPattern') p.elements.forEach(walkPatternDefaults);
    else if (p.type === 'RestElement') walkPatternDefaults(p.argument);
    else if (p.type !== 'Identifier') walk(p, null); // e.g. member expression as a for-of target
  }

  function walk(n, parent) {
    if (!n || typeof n.type !== 'string') return;
    switch (n.type) {
      case 'Identifier':
        if (!defined(n.name)) problems.push(`${file}:${n.loc.start.line}:${n.loc.start.column + 1}  '${n.name}' is not defined`);
        return;
      case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression': {
        const s = new Set();
        n.params.forEach((p) => patternNames(p, s));
        if (n.type === 'FunctionExpression' && n.id) s.add(n.id.name);
        declaredIn(n.body).forEach((x) => s.add(x));
        scopes.push(s);
        n.params.forEach(walkPatternDefaults);
        walk(n.body, n);
        scopes.pop();
        return;
      }
      case 'VariableDeclarator': walkPatternDefaults(n.id); walk(n.init, n); return;
      case 'CatchClause': walkPatternDefaults(n.param); walk(n.body, n); return;
      case 'MemberExpression': walk(n.object, n); if (n.computed) walk(n.property, n); return;
      case 'Property':
        if (n.computed) walk(n.key, n);
        if (parent && parent.type === 'ObjectPattern') walkPatternDefaults(n.value); else walk(n.value, n);
        return;
      case 'MethodDefinition': case 'PropertyDefinition':
        if (n.computed) walk(n.key, n); walk(n.value, n); return;
      case 'LabeledStatement': walk(n.body, n); return;
      case 'BreakStatement': case 'ContinueStatement': case 'MetaProperty': return;
      case 'ClassDeclaration': case 'ClassExpression': walk(n.superClass, n); walk(n.body, n); return;
      case 'AssignmentExpression':
        if (n.left.type === 'ObjectPattern' || n.left.type === 'ArrayPattern') walkPatternDefaults(n.left); else walk(n.left, n);
        walk(n.right, n); return;
      default:
        for (const k of Object.keys(n)) {
          if (k === 'loc' || k === 'start' || k === 'end') continue;
          const v = n[k];
          if (Array.isArray(v)) v.forEach((c) => walk(c, n)); else if (v && typeof v.type === 'string') walk(v, n);
        }
    }
  }
  ast.body.forEach((s) => walk(s, ast));
  return problems;
}

const files = process.argv.slice(2);
if (!files.length) { console.error('usage: node --expose-internals check-names.js <file.js>...'); process.exit(2); }
let all = [];
for (const f of files) all = all.concat(check(f));
all.forEach((p) => console.log(p));
console.log(all.length ? `\n✗ ${all.length} undefined name(s)` : `✓ no undefined names in ${files.length} file(s)`);
process.exit(all.length ? 1 : 0);
