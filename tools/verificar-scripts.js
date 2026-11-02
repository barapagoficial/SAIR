/* Comprueba los scripts de la app (los <script src="js/…"> de index.html).
   Se ejecuta en la CI y se puede lanzar en local:
     npm i --no-save acorn@8 && node tools/verificar-scripts.js

   1. Que ninguna declaración de nivel superior esté repetida entre archivos
      (comparten el ámbito global: una repetición rompe la app al cargar).
   2. Que el código que se ejecuta AL CARGAR un archivo no use nada definido
      en un archivo posterior (todavía no existiría). Dentro de clics,
      temporizadores, observers, etc. sí se puede, porque se ejecutan después. */
const fs = require('fs');
const acorn = require('acorn');

const html = fs.readFileSync('index.html', 'utf8');
const archivos = [...html.matchAll(/<script src="(js\/[^"]+\.js)"><\/script>/g)].map((m) => m[1]);
if (!archivos.length) { console.error('index.html no carga ningún js/*.js'); process.exit(1); }

const trozos = archivos.map((nombre) => ({
  nombre,
  ast: acorn.parse(fs.readFileSync(nombre, 'utf8'), { ecmaVersion: 2022, sourceType: 'script', locations: true }),
}));

const decl = {}; const funciones = {}; const repetidas = [];
const nombresPatron = (p, out) => {
  if (!p) return;
  if (p.type === 'Identifier') out.push(p.name);
  else if (p.type === 'ObjectPattern') p.properties.forEach((x) => nombresPatron(x.value || x.argument, out));
  else if (p.type === 'ArrayPattern') p.elements.forEach((x) => nombresPatron(x, out));
  else if (p.type === 'RestElement') nombresPatron(p.argument, out);
  else if (p.type === 'AssignmentPattern') nombresPatron(p.left, out);
};
const declarar = (nombre, i) => {
  if (decl[nombre] !== undefined) repetidas.push(`${nombre} (${trozos[decl[nombre]].nombre} y ${trozos[i].nombre})`);
  decl[nombre] = i;
};
trozos.forEach((t, i) => {
  for (const n of t.ast.body) {
    if (n.type === 'FunctionDeclaration') { declarar(n.id.name, i); funciones[n.id.name] = n; }
    else if (n.type === 'ClassDeclaration') declarar(n.id.name, i);
    else if (n.type === 'VariableDeclaration') {
      for (const d of n.declarations) {
        const o = []; nombresPatron(d.id, o);
        o.forEach((x) => { declarar(x, i); if (d.init && /Function/.test(d.init.type)) funciones[x] = d.init; });
      }
    }
  }
});

// Llamadas cuyo callback se ejecuta más tarde, no al cargar el archivo.
const DIFERIDOS = new Set(['addEventListener', 'setTimeout', 'setInterval', 'requestAnimationFrame', 'requestIdleCallback',
  'onAuthStateChange', 'observe', 'MutationObserver', 'IntersectionObserver', 'ResizeObserver']);
const problemas = new Set();
function visitar(nodo, i, ctx, vistos) {
  if (!nodo || typeof nodo.type !== 'string') return;
  switch (nodo.type) {
    case 'FunctionDeclaration': return; // solo cuenta si se llama al cargar
    case 'FunctionExpression': case 'ArrowFunctionExpression':
      if (ctx.diferido) return;
      return visitar(nodo.body, i, ctx, vistos);
    case 'Identifier': {
      const j = decl[nodo.name];
      if (j !== undefined && j > i) problemas.add(`${trozos[i].nombre}:${nodo.loc.start.line} usa «${nodo.name}», que se define después en ${trozos[j].nombre} ${ctx.via || ''}`);
      return;
    }
    case 'MemberExpression':
      visitar(nodo.object, i, ctx, vistos); if (nodo.computed) visitar(nodo.property, i, ctx, vistos); return;
    case 'Property':
      if (nodo.computed) visitar(nodo.key, i, ctx, vistos); visitar(nodo.value, i, ctx, vistos); return;
    case 'AssignmentExpression':
      if (nodo.left.type === 'MemberExpression' && !nodo.left.computed && /^on/.test(nodo.left.property.name)) {
        visitar(nodo.left, i, ctx, vistos); visitar(nodo.right, i, { ...ctx, diferido: true }, vistos); return;
      }
      break;
    case 'CallExpression': case 'NewExpression': {
      const c = nodo.callee;
      const nom = c.type === 'Identifier' ? c.name : (c.type === 'MemberExpression' && !c.computed ? c.property.name : '');
      visitar(c, i, ctx, vistos);
      const dif = DIFERIDOS.has(nom);
      for (const a of nodo.arguments) visitar(a, i, dif ? { ...ctx, diferido: true } : ctx, vistos);
      if (c.type === 'Identifier' && funciones[c.name] && !vistos.has(c.name) && decl[c.name] <= i) {
        vistos.add(c.name);
        visitar(funciones[c.name].body, i, { ...ctx, via: `${ctx.via || '(vía'} → ${c.name}` }, vistos);
      }
      return;
    }
  }
  for (const k in nodo) {
    if (k === 'loc' || k === 'start' || k === 'end' || k === 'type') continue;
    const v = nodo[k];
    if (Array.isArray(v)) v.forEach((x) => visitar(x, i, ctx, vistos));
    else if (v && typeof v.type === 'string') visitar(v, i, ctx, vistos);
  }
}
trozos.forEach((t, i) => { for (const n of t.ast.body) visitar(n, i, {}, new Set()); });

let ok = true;
if (repetidas.length) { ok = false; console.error('Declaraciones repetidas entre archivos:\n  ' + repetidas.join('\n  ')); }
if (problemas.size) { ok = false; console.error('Código que se ejecuta al cargar y usa algo de un archivo posterior:\n  ' + [...problemas].map((p) => p.replace(/\(vía( → [^)]*)?\s*$/, (m) => m + ')')).join('\n  ')); }
if (!ok) process.exit(1);
console.log(`✅ ${archivos.length} scripts: ${Object.keys(decl).length} declaraciones sin repetir y sin dependencias hacia delante al cargar.`);
