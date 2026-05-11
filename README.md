# Cognitive Atlas — concept map

An interactive spring/force-directed map of the ~900 concepts in the
[Cognitive Atlas](https://www.cognitiveatlas.org/), colored by subject
area, with directed edges showing the **PARTOF** (has-part, solid) and
**KINDOF** (has-kind, dashed) relationships between concepts.

Inspired by the closer-to-truth concept map
(https://loc.closertotruth.com/map).

## Files

- `index.html` — static page, loads force-graph from CDN, no build step.
- `app.js` — graph wiring: force layout, color/legend, hover highlight, search, details panel.
- `style.css` — minimal dark theme + side panel.
- `fetch_data.py` — pulls everything from the Cognitive Atlas API into `data/`.
- `data/nodes.json`, `data/links.json` — generated graph data (checked in so the page works on GitHub Pages without a Python step).
- `data/_cache/` — per-concept API responses (gitignored, makes re-runs cheap).

## Running locally

```bash
python3 fetch_data.py            # first time only — pulls ~918 concepts, ~3–5 min
python3 -m http.server 8765      # any static server works
# open http://localhost:8765/
```

## How relationships are drawn

The Cognitive Atlas API gives each concept a `relationships` array of
other concepts with two relevant types:

| API type | Meaning                  | Drawn as |
| -------- | ------------------------ | -------- |
| `PARTOF` | A is part of B           | **solid** edge, parent → child |
| `KINDOF` | A is a kind of B         | **dashed** edge, parent → child |

Edges are drawn from the broader concept to the narrower one. The
`direction` field returned by the API (`parent`/`child`) is used to
orient each edge regardless of which side initiated the request — so an
edge appears once, not twice, even though both endpoints reference it.

## Coloring

Nodes are colored by `id_concept_class` (subject area). The 10 named
classes the Cognitive Atlas defines are:

- Perception (`ctp_C1`)
- Attention (`ctp_C2`)
- Reasoning and Decision Making (`ctp_C3`)
- Executive/Cognitive Control (`ctp_C4`)
- Learning and Memory (`ctp_C5`)
- Language (`ctp_C6`)
- Action (`ctp_C7`)
- Emotion (`ctp_C8`)
- Social Function (`ctp_C9`)
- Motivation (`ctp_C10`)

About 45 % of concepts (~413 of 918) are unclassified in the API; they
get a muted gray. Clicking a legend item toggles that class on/off.

## Ambiguities & choices

- **`MEASUREDBY` / contrast edges are not drawn.** Those connect concepts
  to behavioral measures, not other concepts; they roughly double the
  edge count and clutter the ontology view. A separate "measures" map
  could use them later.
- **Unclassified nodes are kept, not hidden.** Almost half the atlas lives
  there; dropping them would gut the graph. Use the legend to toggle off
  if desired.
- **Self-loops and duplicate edges are dropped** during fetch. Edges are
  deduped by `(source, target, type)`.
- **Class display names** are harvested from the live API where present
  and fall back to the canonical 10-class list in `fetch_data.py` for any
  missing ones.
- **Dashed edges** are real Canvas dashes (via force-graph's
  `linkLineDash`). Cosmograph was considered but rejected because its
  WebGL line shader can't render dash patterns; force-graph is fast
  enough at ~900 nodes / a few thousand edges.

## Caveats

- The Cognitive Atlas API is rate-tolerant but slow; the first fetch
  takes a few minutes. Subsequent runs are near-instant thanks to
  `data/_cache/`.
- The atlas is community-edited and noisy — some "concepts" are clearly
  prompt-engineering experiments (e.g. one entry has an entire LLM
  conversation pasted into its `definition_text`). The map shows them
  as-is.

## Publishing to GitHub Pages

```bash
cd cog_atlas_map
git init -b main
git add README.md index.html app.js style.css fetch_data.py data .gitignore
git commit -m "Initial Cognitive Atlas concept map"

gh repo create lynde-wolf/cog-atlas-map \
    --public --source=. --push \
    --description "Interactive force-directed map of the Cognitive Atlas"

gh api -X POST "repos/lynde-wolf/cog-atlas-map/pages" \
    -f "source[branch]=main" -f "source[path]=/"
```

Live URL (~30 s after Pages builds): https://lynde-wolf.github.io/cog-atlas-map/
