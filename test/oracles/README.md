# Oracle harness for ldraw-stl (test/oracles)

Checks `ldraw-stl.mjs` against independent implementations. None of them are vendored; set them up in a work dir:

```sh
export ORACLE_WORK=/some/scratch/dir      # scripts live in test/oracles/
cd $ORACLE_WORK
unzip -q ~/Library/Caches/BrickStore/ldraw/complete.zip 'ldraw/parts/*' 'ldraw/p/*' ldraw/LDConfig.ldr -d lib
git clone --depth 1 https://github.com/kristov/ldraw2stl oracles/kristov_ldraw2stl          # Perl, BFC-aware (no license: oracle only)
git clone --depth 1 https://github.com/davidmargol/lego2stl oracles/davidmargol_lego2stl    # Python, MIT, no BFC
python3 -m venv venv && venv/bin/pip install numpy trimesh lib3mf networkx lxml
mkdir three && (cd three && npm init -y && npm i three@0.170.0)   # three.js LDrawLoader / 3MFLoader
```

- `run-oracles.sh <part...>` then `node compare.mjs $ORACLE_WORK/cmp <part...>`: triangle count, area, bbox and
  per-triangle orientation vs three.js LDrawLoader (low-res primitives), kristov (always p/48 hi-res) and lego2stl.
- `roundtrip.sh <name> <part.dat|model.ldr>`: dat->stl->dat->stl, the generated .dat read by three.js and kristov,
  and the 3MF read back by trimesh.
- `venv/bin/python -I check3mf.py file.3mf`: lib3mf (3MF Consortium reference implementation) + trimesh.

Known oracle quirks (2026-10-19): three.js keeps a part's top-level mirror in the mesh matrix (the runner flips those
triangles like WebGLRenderer does), but nested mirrored parts inside shortcuts (76382p07) still differ there while
kristov and positive per-shell signed volume agree with ldraw-stl. lego2stl ignores BFC (orientation is random)
and indexes primitives by bare filename, so p/48 and p/ collide. brecert/ldraw2stl (Rust port of kristov) does not
build on stable Rust (fncmd needs nightly + a removed proc_macro API). Bambu Studio 2.05's CLI segfaults in
GUI_App::plater() on any load, so it cannot be used to verify 3MF painting headlessly.
