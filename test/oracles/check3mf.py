# check3mf.py file.3mf... : read with lib3mf (reference impl, strict) and trimesh; print stats
import sys, lib3mf, trimesh, numpy as np
from collections import Counter
w = lib3mf.get_wrapper()
for path in sys.argv[1:]:
    m = w.CreateModel()
    r = m.QueryReader("3mf"); r.SetStrictModeActive(len(sys.argv) < 0)
    r.ReadFromFile(path)
    warns = [r.GetWarning(i) for i in range(r.GetWarningCount())]
    mats = m.GetBaseMaterialGroups(); mats.MoveNext(); g = mats.GetCurrentBaseMaterialGroup()
    names = {pid: (g.GetName(pid), g.GetDisplayColor(pid)) for pid in g.GetAllPropertyIDs()}
    it = m.GetMeshObjects(); tri = 0; per = Counter(); objs = 0; manifold = 0
    while it.MoveNext():
        o = it.GetCurrentMeshObject(); objs += 1; tri += o.GetTriangleCount()
        manifold += o.IsManifoldAndOriented()
        for p in o.GetAllTriangleProperties():
            per[names[p.PropertyIDs[0]][0]] += 1
    comp = m.GetComponentsObjects(); ncomp = sum(1 for _ in iter(comp.MoveNext, False))
    sc = trimesh.load(path)
    geoms = list(sc.geometry.values()) if hasattr(sc, 'geometry') else [sc]
    print(f"{path.split('/')[-1]}: lib3mf strict OK, warnings={len(warns)} {warns[:2]}, mesh objects={objs} "
          f"(manifold+oriented {manifold}/{objs}), components objects={ncomp}, triangles={tri}")
    print(f"   per-triangle colours: {dict(per)}")
    print(f"   trimesh: {len(geoms)} geometries, {sum(len(x.faces) for x in geoms)} faces, watertight {sum(x.is_watertight for x in geoms)}/{len(geoms)}, extents {np.round(sc.extents,2)}")
