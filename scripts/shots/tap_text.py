import re
import sys
import xml.etree.ElementTree as ET

# Usage: tap_text.py <dump.xml> <text> [exact|contains]
# Prints "x y" (center of the first matching node's bounds) and exits 0,
# or exits 1 when no node matches.
path, target = sys.argv[1], sys.argv[2]
mode = sys.argv[3] if len(sys.argv) > 3 else "contains"

try:
    root = ET.parse(path).getroot()
except Exception:
    sys.exit(1)

for node in root.iter("node"):
    label = node.get("text") or node.get("content-desc") or ""
    ok = (label == target) if mode == "exact" else (target in label)
    if not ok:
        continue
    m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.get("bounds") or "")
    if m:
        x = (int(m.group(1)) + int(m.group(3))) // 2
        y = (int(m.group(2)) + int(m.group(4))) // 2
        print(x, y)
        sys.exit(0)
sys.exit(1)
