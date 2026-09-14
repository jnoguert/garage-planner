#!/usr/bin/env python3
"""Converteix una llista de segments de paret (x1,y1,x2,y2 en metres) a
crides mkSeg() per enganxar a un preset de src/scene.js.

Entrada: un CSV sense capcalera, una paret per linia: x1,y1,x2,y2
Sortida: les linies JS, a stdout.

Us:  python tools/import_plan.py planol.csv
     python tools/import_plan.py planol.csv --json  > planol.json

Nomes biblioteca estandard. Sense aixo, els segments d'una planta real (com
el garatge de l'usuari, amb cotes com 4.15 m) s'escriuen a ma dins scene.js.
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
                raise ValueError(f"linia {lineno}: calen 4 valors x1,y1,x2,y2, n'hi ha {len(row)}: {row}")
            x1, y1, x2, y2 = (float(v) for v in row)
            if x1 == x2 and y1 == y2:
                raise ValueError(f"linia {lineno}: segment de longitud zero ({x1},{y1})")
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
    """ponytail: comprovacio minima en lloc d'una suite de tests per 40 linies."""
    import os
    import tempfile

    fd, path = tempfile.mkstemp(suffix=".csv")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write("# comentari, s'ignora\n0,0,19.7,0\n19.7,4.15,7.65,4.15\n")
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
                raise AssertionError("hauria d'haver llancat per longitud zero")
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
