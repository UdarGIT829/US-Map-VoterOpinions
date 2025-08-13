# https://api.census.gov/data/2023/acs/acs5/profile/variables.json
#
#
# # Race/ethnicity & population (DP05) — all counties in TX
# https://api.census.gov/data/2023/acs/acs5/profile?get=group(DP05)&for=county:*&in=state:48&key=YOUR_KEY

# # Age structure (S0101) — all counties in TX
# https://api.census.gov/data/2023/acs/acs5/subject?get=group(S0101)&for=county:*&in=state:48&key=YOUR_KEY

# # Median household income (DP03)
# https://api.census.gov/data/2023/acs/acs5/profile?get=DP03_0062E,NAME&for=county:*&in=state:48&key=YOUR_KEY

import os
from dotenv import load_dotenv

# Load constants and API Keys
load_dotenv()

CENSUS_API_KEY = ""
if 'CENSUS_API_KEY' in os.environ:
    CENSUS_API_KEY = os.getenv('CENSUS_API_KEY')

# Pull variables def (if not exists)

import requests
import re
from collections import defaultdict
import xml.etree.ElementTree as ET
from xml.dom import minidom
from typing import Dict, Any, Optional, Iterable

class CensusProfileTree:
    URL = "https://api.census.gov/data/2023/acs/acs5/profile/variables.json"

    # Map ACS suffixes to human-readable measure names
    _SUFFIX_MAP = {
        "E":   "estimate",
        "M":   "moe",
        "PE":  "percent_estimate",
        "PM":  "percent_moe",
        "EA":  "estimate_annotation",
        "MA":  "moe_annotation",
        "PEA": "percent_estimate_annotation",
        "PMA": "percent_moe_annotation",
    }
    _VAR_RE = re.compile(
        r"^(?P<group>DP\d{2}PR?|DP\d{2})_(?P<line>\d{4})(?P<suffix>PEA|PMA|PE|PM|EA|MA|E|M)$"
    )

    def __init__(self, url: str = None, timeout: int = 30):
        url = url or self.URL
        variables = requests.get(url, timeout=timeout).json().get("variables", {})
        self._raw = variables

        # 1) Build families keyed by base "group_line" (e.g., DP02_0126)
        families = defaultdict(lambda: {"meta": None, "members": {}})
        for var, info in variables.items():
            m = self._VAR_RE.match(var)
            if not m:
                continue  # skip non-DPxx profile vars like 'for', 'in', etc.
            parts = m.groupdict()
            base = f"{parts['group']}_{parts['line']}"
            measure = self._SUFFIX_MAP.get(parts["suffix"], parts["suffix"])
            fam = families[base]
            # keep one representative meta (label/concept/group) at base level
            if fam["meta"] is None:
                fam["meta"] = {
                    "base": base,
                    "group": info.get("group"),
                    "concept": info.get("concept"),
                    "label": info.get("label"),
                }
            fam["members"][measure] = {
                "var": var,
                "label": info.get("label"),
                "predicateType": info.get("predicateType"),
                "attributes": info.get("attributes"),
            }

        self._families = dict(families)

        # 2) Build a label-driven tree
        # We’ll use the label, split on "!!". We strip a leading "Estimate"/"Percent"
        # token so the tree is about topics rather than measure type.
        root = {}
        for base, fam in self._families.items():
            label = fam["meta"]["label"] or ""
            path = [p.strip() for p in label.split("!!") if p.strip()]
            # remove leading measure word if present
            if path and path[0].lower() in {"estimate", "percent"}:
                path = path[1:]

            # Fallback path if label is missing/odd
            if not path:
                path = [fam["meta"]["concept"] or fam["meta"]["group"] or base]

            # Insert into tree; leaves carry the whole family
            node = root
            for token in path:
                node = node.setdefault(token, {})
            # At the leaf, store by base id (so multiple families under same label leaf don’t collide)
            node.setdefault("_families_", {})[base] = fam

        self._tree = root

        # 3) Convenience lookups
        self._by_group = defaultdict(list)
        for base, fam in self._families.items():
            self._by_group[fam["meta"]["group"]].append(fam)

        self._by_attribute = {}
        for var, info in variables.items():
            attrs = info.get("attributes")
            if attrs:
                for a in attrs.split(","):
                    a = a.strip()
                    if a:
                        # attribute points back to the family that owns this var
                        m = self._VAR_RE.match(var)
                        if m:
                            base = f"{m.group('group')}_{m.group('line')}"
                            self._by_attribute[a] = self._families.get(base)

    # -------- Public API --------

    @property
    def tree(self):
        """The full label-driven tree (nested dict)."""
        return self._tree

    def subtree(self, path):
        """
        Get a subtree by a path like ["ANCESTRY","Total population","Arab"].
        Returns the nested dict (or None if not found).
        """
        if isinstance(path, str):
            # allow "ANCESTRY/Total population/Arab"
            path = [p for p in path.split("/") if p]
        node = self._tree
        for token in path:
            node = node.get(token)
            if node is None:
                return None
        return node

    def families_at(self, path):
        """
        Return all families at a label leaf (dict of base -> family), or {}.
        """
        node = self.subtree(path)
        if not node:
            return {}
        return node.get("_families_", {})

    def family(self, code):
        """
        Get the sibling family given any variable code (e.g., DP02_0126E).
        """
        m = self._VAR_RE.match(code)
        if not m:
            return None
        base = f"{m.group('group')}_{m.group('line')}"
        return self._families.get(base)

    def by_group(self, group):
        """All families for a DP group (e.g., 'DP02')."""
        return self._by_group.get(group, [])

    def by_attribute(self, attribute):
        """Family that owns a given attribute code (e.g., 'DP05_0050PMA')."""
        return self._by_attribute.get(attribute)

    # Tiny pretty-printer for exploring
    def pprint(self, node=None, depth=0, max_children=8):
        if node is None:
            node = self._tree
        for k, v in node.items():
            if k == "_families_":
                print("  " * depth + f"[{len(v)} families]")
                continue
            print("  " * depth + f"- {k}")
            if isinstance(v, dict):
                # avoid dumping huge branches by default
                kids = [(kk, vv) for kk, vv in v.items() if kk != "_families_"]
                for kk, vv in kids[:max_children]:
                    self.pprint({kk: vv}, depth + 1, max_children)
                if len(kids) > max_children:
                    print("  " * (depth + 1) + f"... (+{len(kids)-max_children} more)")

    # -------- XML dump --------
    def dump_xml(
        self,
        path: str,
        root_name: str = "ACSProfile",
        include_labels: bool = True,
        include_attributes: bool = True,
        pretty: bool = True,
    ):
        """
        Write the entire label-driven tree to an XML file.

        Each label level is a <Node name="...">.
        Leaves contain one or more <Family> elements, each with <Member>s
        for estimate/moe/percent/etc.
        """
        root_el = ET.Element(root_name)
        self._append_node_xml(root_el, self._tree, include_labels, include_attributes)

        # Serialize
        xml_bytes = ET.tostring(root_el, encoding="utf-8")
        if pretty:
            # Pretty-print with indents
            dom = minidom.parseString(xml_bytes)
            xml_bytes = dom.toprettyxml(indent="  ", encoding="utf-8")
        with open(path, "wb") as f:
            f.write(xml_bytes)

    def _append_node_xml(
        self,
        parent: ET.Element,
        node: Dict[str, Any],
        include_labels: bool,
        include_attributes: bool,
    ):
        # Families block at this node (if any)
        fams: Optional[Dict[str, Any]] = node.get("_families_") if isinstance(node, dict) else None

        # First, create child Node elements for each label key
        for key, val in sorted((k, v) for k, v in node.items() if k != "_families_"):
            child = ET.SubElement(parent, "Node", {"name": key})
            if isinstance(val, dict):
                self._append_node_xml(child, val, include_labels, include_attributes)

        # Then, append Families for this leaf (if present)
        if fams:
            for base, fam in sorted(fams.items()):
                meta = fam.get("meta", {})
                fam_el = ET.SubElement(
                    parent,
                    "Family",
                    {
                        "base": meta.get("base", base),
                        "group": str(meta.get("group", "")),
                        "concept": str(meta.get("concept", "")),
                    },
                )
                if include_labels:
                    # representative label for the family
                    lab = meta.get("label") or ""
                    lab_el = ET.SubElement(fam_el, "FamilyLabel")
                    lab_el.text = lab

                # Members (estimate/moe/percent/etc.)
                members: Dict[str, Dict[str, Any]] = fam.get("members", {})
                for measure, minfo in sorted(members.items()):
                    mem_attr = {
                        "measure": measure,
                        "var": str(minfo.get("var", "")),
                        "predicateType": str(minfo.get("predicateType", "")),
                    }
                    mem_el = ET.SubElement(fam_el, "Member", mem_attr)
                    if include_labels and minfo.get("label"):
                        lbl_el = ET.SubElement(mem_el, "Label")
                        lbl_el.text = minfo["label"]

                    if include_attributes and minfo.get("attributes"):
                        attrs_el = ET.SubElement(mem_el, "Attributes")
                        for a in (x.strip() for x in minfo["attributes"].split(",") if x.strip()):
                            a_el = ET.SubElement(attrs_el, "Attr")
                            a_el.text = a


# ---------------- Example usage ----------------
if __name__ == "__main__":
    cpt = CensusProfileTree()

    # Explore the top-level tree
    cpt.pprint(max_children=5)

    # Export to a readable xml file
    cpt.dump_xml("acs_profile_tree.xml")
    print("Wrote acs_profile_tree.xml")

    # Grab a specific branch
    branch = cpt.subtree(["ANCESTRY", "Total population", "Arab"])
    print("\nBranch keys:", list(branch.keys())[:6] if branch else None)

    # Families at that leaf
    fams = cpt.families_at(["ANCESTRY", "Total population", "Arab"])
    for base, fam in list(fams.items())[:1]:
        print("\nExample family at leaf:", base)
        print("Meta:", fam["meta"])
        print("Members:", list(fam["members"].keys()))  # e.g., estimate, moe, percent_estimate, ...

    # Lookups still work
    print("\nBy group DP02:", len(cpt.by_group("DP02")))
    print("By attribute DP05_0050PMA ->",
          cpt.by_attribute("DP05_0050PMA")["meta"]["base"] if cpt.by_attribute("DP05_0050PMA") else None)
