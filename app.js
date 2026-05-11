// Cognitive Atlas concept map — force-graph viewer.
// Nodes colored by subject area (id_concept_class).
// Edges: PARTOF → solid, KINDOF → dashed.

const CA_BASE = "https://www.cognitiveatlas.org/concept/id/";

// Distinct, color-blind-friendly palette for ~10 subject-area classes.
const PALETTE = [
  "#4e79a7", "#f28e2c", "#e15759", "#76b7b2", "#59a14f",
  "#edc949", "#af7aa1", "#ff9da7", "#9c755f", "#bab0ab",
];
const UNCLASSIFIED_COLOR = "#3a4150";

const LINK_STYLE = {
  PARTOF: { color: "rgba(201,209,217,0.55)", dash: null,    width: 1.1 },
  KINDOF: { color: "rgba(240,136,62,0.75)",  dash: [4, 3],  width: 1.1 },
};

const state = {
  nodes: [],
  links: [],
  byId: new Map(),
  neighbors: new Map(),         // id -> Set(id)
  incident: new Map(),          // id -> Set(linkIndex)
  classColors: new Map(),       // class_name -> hex
  hidden: new Set(),            // class names currently hidden
  hiddenRels: new Set(),        // relationship types currently hidden
  highlight: null,              // {nodes:Set, links:Set} or null
  selected: null,
};

async function loadData() {
  const [nodes, links] = await Promise.all([
    fetch("data/nodes.json").then(r => r.json()),
    fetch("data/links.json").then(r => r.json()),
  ]);
  state.nodes = nodes;
  state.links = links;
  for (const n of nodes) state.byId.set(n.id, n);

  // assign colors to subject-area classes in alphabetical order, stable.
  const classNames = [...new Set(nodes.map(n => n.class_name))].sort();
  let i = 0;
  for (const cn of classNames) {
    state.classColors.set(cn, cn === "Unclassified" ? UNCLASSIFIED_COLOR : PALETTE[i++ % PALETTE.length]);
  }

  // adjacency for hover highlighting
  for (const n of nodes) {
    state.neighbors.set(n.id, new Set());
    state.incident.set(n.id, new Set());
  }
  links.forEach((l, idx) => {
    state.neighbors.get(l.source)?.add(l.target);
    state.neighbors.get(l.target)?.add(l.source);
    state.incident.get(l.source)?.add(idx);
    state.incident.get(l.target)?.add(idx);
  });
}

const NODE_REL_SIZE = 4;
function nodeDegree(n) {
  return state.neighbors.get(n.id)?.size ?? 0;
}
// force-graph renders radius = sqrt(val) * nodeRelSize, so passing degree
// as `val` gives a natural sqrt-scaled radius (high-degree hubs grow, but
// not absurdly).
function nodeVal(n) {
  return Math.max(0.6, nodeDegree(n));
}
function nodeRadius(n) {
  return Math.sqrt(nodeVal(n)) * NODE_REL_SIZE;
}

function nodeVisible(n) {
  return !state.hidden.has(n.class_name);
}

function linkVisible(l) {
  if (state.hiddenRels.has(l.type)) return false;
  const s = typeof l.source === "object" ? l.source : state.byId.get(l.source);
  const t = typeof l.target === "object" ? l.target : state.byId.get(l.target);
  return s && t && nodeVisible(s) && nodeVisible(t);
}

let Graph;

// force-graph@1.x has no public refresh(); re-setting an accessor invalidates
// its style caches and schedules a redraw.
function redraw() {
  if (!Graph) return;
  Graph.nodeColor(Graph.nodeColor()).linkColor(Graph.linkColor());
}

function initGraph() {
  Graph = ForceGraph()(document.getElementById("graph"))
    .backgroundColor("#0e1116")
    .graphData({ nodes: state.nodes, links: state.links })
    .nodeId("id")
    .nodeLabel(n => `<div style="font:13px -apple-system;color:#e6edf3;background:#161b22;padding:4px 8px;border:1px solid #2a313c;border-radius:4px;max-width:280px"><b>${escapeHtml(n.name)}</b><br><span style="color:#8b949e">${escapeHtml(n.class_name)}</span></div>`)
    .nodeVal(nodeVal)
    .nodeRelSize(NODE_REL_SIZE)
    .nodeColor(n => {
      if (state.highlight && !state.highlight.nodes.has(n.id)) return "rgba(120,120,120,0.18)";
      return state.classColors.get(n.class_name) || UNCLASSIFIED_COLOR;
    })
    .nodeCanvasObjectMode(() => "after")
    .nodeCanvasObject((n, ctx, scale) => {
      // labels appear once the user zooms in enough
      if (scale < 1.6 && !(state.highlight && state.highlight.nodes.has(n.id))) return;
      const label = n.name;
      const fontSize = 11 / scale;
      ctx.font = `${fontSize}px -apple-system, sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(230,237,243,0.92)";
      const r = nodeRadius(n) * 0.5 + 2;
      ctx.fillText(label, n.x + r, n.y);
    })
    .linkColor(l => {
      if (state.highlight) {
        const key = linkKey(l);
        if (!state.highlight.links.has(key)) return "rgba(120,120,120,0.06)";
      }
      return LINK_STYLE[l.type]?.color || "rgba(150,150,150,0.4)";
    })
    .linkWidth(l => LINK_STYLE[l.type]?.width || 1)
    .linkLineDash(l => LINK_STYLE[l.type]?.dash || null)
    .linkDirectionalArrowLength(3.5)
    .linkDirectionalArrowRelPos(1)
    .linkDirectionalArrowColor(l => LINK_STYLE[l.type]?.color || "rgba(150,150,150,0.6)")
    .linkVisibility(linkVisible)
    .nodeVisibility(nodeVisible)
    .onNodeHover(n => {
      if (!n) { state.highlight = null; redraw(); return; }
      const nodes = new Set([n.id, ...state.neighbors.get(n.id) || []]);
      const links = new Set();
      for (const idx of state.incident.get(n.id) || []) {
        links.add(linkKey(state.links[idx]));
      }
      state.highlight = { nodes, links };
      redraw();
    })
    .onNodeClick(n => showDetails(n))
    .onBackgroundClick(() => hideDetails())
    .d3AlphaDecay(0.025)
    .d3VelocityDecay(0.35)
    .cooldownTicks(200);

  // size to viewport
  const resize = () => Graph.width(window.innerWidth).height(window.innerHeight);
  resize();
  window.addEventListener("resize", resize);

  // Tame the layout: weaker repulsion + gentle centering pulls disconnected
  // nodes in instead of letting them drift to infinity.
  Graph.d3Force("charge").strength(-28).distanceMax(220);
  Graph.d3Force("link").distance(28).strength(0.6);
  Graph.d3Force("x", d3.forceX(0).strength(0.04));
  Graph.d3Force("y", d3.forceY(0).strength(0.04));
  // d3-force UMD exposes as `d3`; if it's missing, fall through (no extra centering).
  Graph.d3ReheatSimulation();
}

function linkKey(l) {
  const s = typeof l.source === "object" ? l.source.id : l.source;
  const t = typeof l.target === "object" ? l.target.id : l.target;
  return `${s}|${t}|${l.type}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}

function renderLegend() {
  const ul = document.getElementById("classes");
  const entries = [...state.classColors.entries()];
  entries.sort((a, b) => {
    if (a[0] === "Unclassified") return 1;
    if (b[0] === "Unclassified") return -1;
    return a[0].localeCompare(b[0]);
  });
  ul.innerHTML = "";
  for (const [name, color] of entries) {
    const count = state.nodes.filter(n => n.class_name === name).length;
    const li = document.createElement("li");
    li.innerHTML = `<span class="swatch dot" style="background:${color}"></span><span>${escapeHtml(name)} <span style="color:var(--muted)">(${count})</span></span>`;
    li.addEventListener("click", () => {
      if (state.hidden.has(name)) state.hidden.delete(name);
      else state.hidden.add(name);
      li.classList.toggle("dim", state.hidden.has(name));
      redraw();
    });
    ul.appendChild(li);
  }
}

function setupRelToggle() {
  document.querySelectorAll('#rels li[data-rel]').forEach(li => {
    li.addEventListener('click', () => {
      const rel = li.dataset.rel;
      if (state.hiddenRels.has(rel)) state.hiddenRels.delete(rel);
      else state.hiddenRels.add(rel);
      li.classList.toggle('dim', state.hiddenRels.has(rel));
      redraw();
    });
  });
}

function setupSearch() {
  const input = document.getElementById("search");
  const suggest = document.getElementById("suggest");

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { suggest.hidden = true; suggest.innerHTML = ""; return; }
    const hits = state.nodes
      .filter(n => n.name.toLowerCase().includes(q) || (n.alias || "").toLowerCase().includes(q))
      .slice(0, 20);
    suggest.innerHTML = hits.map(n => `<li data-id="${n.id}">${escapeHtml(n.name)} <span style="color:var(--muted);font-size:11px">${escapeHtml(n.class_name)}</span></li>`).join("");
    suggest.hidden = hits.length === 0;
  });

  suggest.addEventListener("click", e => {
    const li = e.target.closest("li");
    if (!li) return;
    const n = state.byId.get(li.dataset.id);
    if (!n) return;
    input.value = n.name;
    suggest.hidden = true;
    focusNode(n);
  });

  input.addEventListener("blur", () => setTimeout(() => suggest.hidden = true, 150));
}

function focusNode(n) {
  if (n.x == null || n.y == null) return;
  Graph.centerAt(n.x, n.y, 600);
  Graph.zoom(4, 600);
  showDetails(n);
  // pin highlight
  const nodes = new Set([n.id, ...state.neighbors.get(n.id) || []]);
  const links = new Set();
  for (const idx of state.incident.get(n.id) || []) {
    links.add(linkKey(state.links[idx]));
  }
  state.highlight = { nodes, links };
  redraw();
}

function showDetails(n) {
  const el = document.getElementById("details");
  document.getElementById("d-name").textContent = n.name;
  document.getElementById("d-class").textContent = n.class_name;
  const aliasEl = document.getElementById("d-alias");
  aliasEl.textContent = n.alias ? `Aliases: ${n.alias}` : "";
  aliasEl.style.display = n.alias ? "" : "none";
  document.getElementById("d-def").textContent = n.definition || "(no definition)";
  const a = document.getElementById("d-link");
  a.href = `${CA_BASE}${n.id}/`;
  a.textContent = "View on cognitiveatlas.org →";
  el.hidden = false;
  state.selected = n;
}

function hideDetails() {
  document.getElementById("details").hidden = true;
  state.highlight = null;
  state.selected = null;
  redraw();
}

document.getElementById("close").addEventListener("click", hideDetails);

(async function main() {
  try {
    await loadData();
  } catch (e) {
    document.getElementById("graph").innerHTML =
      `<div style="color:#e6edf3;padding:24px;font-family:sans-serif">Failed to load data. Did you run <code>python3 fetch_data.py</code>?<br><br><pre>${escapeHtml(e.message)}</pre></div>`;
    return;
  }
  initGraph();
  renderLegend();
  setupRelToggle();
  setupSearch();
})();
