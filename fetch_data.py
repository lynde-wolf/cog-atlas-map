"""Pull all Cognitive Atlas concepts and concept-concept relationships.

Writes data/nodes.json and data/links.json for the force-graph viewer.

The /api/v-alpha/concept endpoint with no args returns a flat list of all
concepts (~918) but without their relationships. To get relationships we
must fetch each concept by id. Results are cached to data/_cache/ so re-runs
are cheap and resumable.
"""

import json
import time
import urllib.request
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).parent
DATA = ROOT / "data"
CACHE = DATA / "_cache"
DATA.mkdir(exist_ok=True)
CACHE.mkdir(exist_ok=True)

API = "https://www.cognitiveatlas.org/api/v-alpha/concept"

# Subject-area display names harvested from concepts' conceptclasses arrays.
# Fallback table covers the canonical 10 classes if the live data omits any.
CLASS_FALLBACK = {
    "ctp_C1": "Perception",
    "ctp_C2": "Attention",
    "ctp_C3": "Reasoning and Decision Making",
    "ctp_C4": "Executive/Cognitive Control",
    "ctp_C5": "Learning and Memory",
    "ctp_C6": "Language",
    "ctp_C7": "Action",
    "ctp_C8": "Emotion",
    "ctp_C9": "Social Function",
    "ctp_C10": "Motivation",
}


def http_get_json(url: str, retries: int = 3, delay: float = 1.0):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "cog-atlas-map/0.1"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            if attempt == retries - 1:
                raise
            print(f"  retry {attempt+1}/{retries} after error: {e}")
            time.sleep(delay * (attempt + 1))


def fetch_all_concepts():
    cache = CACHE / "_all.json"
    if cache.exists():
        return json.loads(cache.read_text())
    print("Fetching full concept list...")
    data = http_get_json(API)
    cache.write_text(json.dumps(data))
    return data


def fetch_concept(concept_id: str):
    cache = CACHE / f"{concept_id}.json"
    if cache.exists():
        return json.loads(cache.read_text())
    url = f"{API}?id={urllib.parse.quote(concept_id)}"
    data = http_get_json(url)
    cache.write_text(json.dumps(data))
    return data


def main():
    all_concepts = fetch_all_concepts()
    print(f"Total concepts: {len(all_concepts)}")

    # First pass: node table from the flat list.
    nodes = {}
    for c in all_concepts:
        cid = c["id"]
        nodes[cid] = {
            "id": cid,
            "name": c.get("name", cid),
            "definition": (c.get("definition_text") or "").strip(),
            "class_id": c.get("id_concept_class") or "",
            "class_name": "",
            "alias": c.get("alias") or "",
        }

    # Second pass: per-concept fetch for relationships + class names.
    class_names = {}
    links = []
    seen_link = set()  # canonical (a,b,type) — undirected dedupe per type

    for i, cid in enumerate(list(nodes.keys())):
        if i % 25 == 0:
            print(f"  [{i}/{len(nodes)}] {cid}")
        try:
            detail = fetch_concept(cid)
        except Exception as e:
            print(f"  skip {cid}: {e}")
            continue

        # harvest class display name
        for cc in detail.get("conceptclasses") or []:
            if cc.get("id") and cc.get("name"):
                class_names[cc["id"]] = cc["name"]

        for rel in detail.get("relationships") or []:
            target = rel.get("id")
            rtype = rel.get("relationship")  # PARTOF / KINDOF
            direction = rel.get("direction")  # 'parent' or 'child'
            if not target or target not in nodes or rtype not in {"PARTOF", "KINDOF"}:
                continue
            # Normalize so edge goes from parent -> child (broader -> narrower).
            if direction == "parent":
                src, dst = target, cid
            else:
                src, dst = cid, target
            key = (src, dst, rtype)
            if key in seen_link or src == dst:
                continue
            seen_link.add(key)
            links.append({"source": src, "target": dst, "type": rtype})

        # gentle on the API
        if not (CACHE / f"{cid}.json").exists():
            time.sleep(0.05)

    # Stitch class names into nodes.
    for cid, name in CLASS_FALLBACK.items():
        class_names.setdefault(cid, name)
    for n in nodes.values():
        n["class_name"] = class_names.get(n["class_id"], "Unclassified") if n["class_id"] else "Unclassified"

    nodes_list = list(nodes.values())

    (DATA / "nodes.json").write_text(json.dumps(nodes_list))
    (DATA / "links.json").write_text(json.dumps(links))
    (DATA / "classes.json").write_text(json.dumps(class_names, indent=2))

    print()
    print(f"Wrote {len(nodes_list)} nodes, {len(links)} links")
    by_type = {}
    for l in links:
        by_type[l["type"]] = by_type.get(l["type"], 0) + 1
    print(f"By type: {by_type}")
    by_class = {}
    for n in nodes_list:
        by_class[n["class_name"]] = by_class.get(n["class_name"], 0) + 1
    print(f"By class: {by_class}")


if __name__ == "__main__":
    main()
