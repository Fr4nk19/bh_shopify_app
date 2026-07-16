#!/usr/bin/env node
/**
 * Herramienta de consulta del grafo del codebase (graphify).
 *
 * Uso:
 *   node graphify-out/query.mjs query <texto>        Busca nodos por id/path/summary
 *   node graphify-out/query.mjs node <id>            Muestra un nodo y sus aristas
 *   node graphify-out/query.mjs explain <id>         Nodo + vecinos + comunidad
 *   node graphify-out/query.mjs path <a> <b>         Camino más corto (BFS, no dirigido)
 *   node graphify-out/query.mjs gods                 God nodes (más conectados)
 *   node graphify-out/query.mjs communities          Lista comunidades y miembros
 *   node graphify-out/query.mjs findings             Hallazgos registrados en el grafo
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const g = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "graph.json"), "utf8"));
const [, , cmd, ...args] = process.argv;
const byId = new Map(g.nodes.map((n) => [n.id, n]));

const outEdges = (id) => g.edges.filter((e) => e.from === id);
const inEdges = (id) => g.edges.filter((e) => e.to === id);

function printNode(n) {
  console.log(`\n■ ${n.id} [${n.type}]${n.god_node ? " ★ god node" : ""}`);
  console.log(`  path: ${n.path}`);
  console.log(`  comunidad: ${n.community} — ${g.communities[n.community]?.label ?? ""}`);
  console.log(`  ${n.summary}`);
}

function printEdges(id) {
  const outs = outEdges(id);
  const ins = inEdges(id);
  if (outs.length) {
    console.log(`\n  → depende de (${outs.length}):`);
    for (const e of outs) console.log(`    ${e.broken ? "⚠ " : ""}${e.to}  (${e.type}: ${e.detail})`);
  }
  if (ins.length) {
    console.log(`\n  ← usado por (${ins.length}):`);
    for (const e of ins) console.log(`    ${e.broken ? "⚠ " : ""}${e.from}  (${e.type}: ${e.detail})`);
  }
}

switch (cmd) {
  case "query": {
    const q = args.join(" ").toLowerCase();
    if (!q) { console.error("Falta el texto de búsqueda."); process.exit(1); }
    const hits = g.nodes.filter((n) =>
      [n.id, n.path, n.summary, n.community].join(" ").toLowerCase().includes(q)
    );
    if (!hits.length) console.log("Sin resultados.");
    for (const n of hits) printNode(n);
    break;
  }
  case "node":
  case "explain": {
    const n = byId.get(args[0]);
    if (!n) { console.error(`Nodo no encontrado: ${args[0]} (usa 'query' para buscar ids)`); process.exit(1); }
    printNode(n);
    printEdges(n.id);
    if (cmd === "explain") {
      const c = g.communities[n.community];
      if (c) console.log(`\n  Comunidad "${c.label}": ${c.description}`);
      const relevant = g.findings.filter((f) => f.node === n.id);
      for (const f of relevant) console.log(`\n  ⚠ [${f.severity}] ${f.detail}`);
    }
    break;
  }
  case "path": {
    const [a, b] = args;
    if (!byId.has(a) || !byId.has(b)) { console.error("Ambos nodos deben existir. Usa 'query' para buscar ids."); process.exit(1); }
    const adj = new Map(g.nodes.map((n) => [n.id, []]));
    for (const e of g.edges) { adj.get(e.from).push(e.to); adj.get(e.to).push(e.from); }
    const prev = new Map([[a, null]]);
    const queue = [a];
    while (queue.length && !prev.has(b)) {
      const cur = queue.shift();
      for (const nb of adj.get(cur)) if (!prev.has(nb)) { prev.set(nb, cur); queue.push(nb); }
    }
    if (!prev.has(b)) { console.log("Sin camino."); break; }
    const path = [];
    for (let cur = b; cur !== null; cur = prev.get(cur)) path.unshift(cur);
    console.log(path.join("  →  "));
    break;
  }
  case "gods": {
    for (const gn of g.god_nodes) {
      console.log(`★ ${gn.id}  (in-degree ${gn.in_degree})`);
      console.log(`  ${gn.reason}\n`);
    }
    break;
  }
  case "communities": {
    for (const [id, c] of Object.entries(g.communities)) {
      console.log(`▸ ${id} — ${c.label} (${c.members.length} nodos)`);
      console.log(`  ${c.description}`);
      console.log(`  ${c.members.join(", ")}\n`);
    }
    break;
  }
  case "findings": {
    for (const f of g.findings) console.log(`[${f.severity}] ${f.node}: ${f.detail}\n`);
    break;
  }
  default:
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0] + "*/");
}
