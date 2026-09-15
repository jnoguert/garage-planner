#!/usr/bin/env python3
"""Convert a list of wall segments (x1,y1,x2,y2 in metres) into mkSeg() calls
to paste into a preset in src/scene.js.

Input: a headerless CSV, one wall per line: x1,y1,x2,y2
Output: the JS lines, on stdout.

Usage:  python tools/import_plan.py plan.csv
        python tools/import_plan.py plan.csv --json  > plan.json

Standard library only. Without this, the segments of a real floor plan (like
the user's garage, with dimensions such as 4.15 m) have to be written by hand
inside scene.js.
"""
import csv
import json
import sys


def read_segments(path):
    segs = []
    with open(path, newline="", encoding="utf-8") as f:
        for lineno, row in enumerate(csv.reader(f), 1):
            row = [c.strip() for c in row if c.strip() != ""]
            if not row or row[0].startswith("#"):
                continue
            if len(row) != 4:
                raise ValueError(f"line {lineno}: 4 values x1,y1,x2,y2 are required, got {len(row)}: {row}")
            x1, y1, x2, y2 = (float(v) for v in row)
            if x1 == x2 and y1 == y2:
                raise ValueError(f"line {lineno}: zero-length segment ({x1},{y1})")
            segs.append((x1, y1, x2, y2))
    return segs


def to_js(segs):
    body = ",\n  ".join(f"mkSeg({x1:g}, {y1:g}, {x2:g}, {y2:g})" for x1, y1, x2, y2 in segs)
    return f"world.segs = [\n  {body},\n];"


def to_json(segs):
    return json.dumps([{"x1": x1, "y1": y1, "x2": x2, "y2": y2} for x1, y1, x2, y2 in segs], indent=2)


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 0
    as_json = "--json" in argv
    path = next(a for a in argv if not a.startswith("--"))
    segs = read_segments(path)
    print(to_json(segs) if as_json else to_js(segs))
    return 0


def _demo():
    """ponytail: a minimal check instead of a test suite for 40 lines."""
    import os
    import tempfile

    fd, path = tempfile.mkstemp(suffix=".csv")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write("# a comment, ignored\n0,0,19.7,0\n19.7,4.15,7.65,4.15\n")
        segs = read_segments(path)
        assert segs == [(0.0, 0.0, 19.7, 0.0), (19.7, 4.15, 7.65, 4.15)], segs
        js = to_js(segs)
        assert "mkSeg(0, 0, 19.7, 0)" in js, js
        assert "mkSeg(19.7, 4.15, 7.65, 4.15)" in js, js
        j = json.loads(to_json(segs))
        assert j[1]["y2"] == 4.15, j

        fd2, bad = tempfile.mkstemp(suffix=".csv")
        os.close(fd2)
        try:
            with open(bad, "w", encoding="utf-8") as f:
                f.write("0,0,0,0\n")
            try:
                read_segments(bad)
                raise AssertionError("should have raised for a zero-length segment")
            except ValueError:
                pass
        finally:
            os.remove(bad)
        print("demo OK", file=sys.stderr)
    finally:
        os.remove(path)


if __name__ == "__main__":
    if "--demo" in sys.argv:
        _demo()
    else:
        sys.exit(main(sys.argv[1:]))
