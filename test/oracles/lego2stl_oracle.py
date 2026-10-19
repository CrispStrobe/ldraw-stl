# lego2stl_oracle.py <oracles dir> <ldraw lib dir> <part.dat> <out.json> : davidmargol/lego2stl LDrawMesher, raw output
import sys, json, types, pathlib
sys.modules['requests'] = types.ModuleType('requests')  # oracle runs offline
pil = types.ModuleType('PIL'); pil.Image = None; sys.modules['PIL'] = pil
sys.path.insert(0, sys.argv[1] + '/davidmargol_lego2stl')
import lego2stl as L
lib = L.LDrawLibrary.__new__(L.LDrawLibrary); lib.file_index = {}; lib.colors = {}
lib.root = pathlib.Path(sys.argv[2]); lib._build_index(); lib._load_colors()
mesher = L.LDrawMesher(lib)
cms = mesher.mesh_part(lib.resolve(sys.argv[3]), 'Main', 'A0A5A9')
tris = []
for cm in cms:
    for f in cm.mesh.faces:
        tris.append([float(c) for i in f for c in cm.mesh.vertices[i]])
json.dump({'frame': 'mm-ldraw', 'tris': tris}, open(sys.argv[4], 'w'))
