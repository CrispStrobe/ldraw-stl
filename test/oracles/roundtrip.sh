#!/bin/sh
# roundtrip.sh <name> <input (lib part name or .ldr path)>
S=${ORACLE_WORK:?set ORACLE_WORK to the oracle work dir (see README.md)}
H=$(cd "$(dirname "$0")" && pwd); TOOL=$H/../../src/cli.mjs
n=$1; in=$2; d=$S/rt2/$n; L=$S/rt2/lib; mkdir -p $d $L/parts; cp -n $S/lib/ldraw/LDConfig.ldr $L/ 2>/dev/null
node $TOOL dat2stl $in -o $d/A.stl >/dev/null                                     # 1. LDraw -> STL (repaired)
node $TOOL stl2dat $d/A.stl -o $L/parts/rt-$n.dat --condlines >/dev/null           # 2. STL -> LDraw
node $TOOL dat2stl $L/parts/rt-$n.dat -o $d/C.stl --no-repair --weld 0.000001 >/dev/null   # 3. back to STL
node $TOOL dat2stl $in -o $d/D.3mf >/dev/null                                     # 4. LDraw -> 3MF
$S/venv/bin/python -I -c "
import trimesh,sys; s=trimesh.load(sys.argv[1]); g=list(s.geometry.values())
trimesh.util.concatenate([x.apply_transform(s.graph.get(n)[0]) or x for n,x in [(k, s.geometry[s.graph.get(k)[1]].copy()) for k in s.graph.nodes_geometry]]).export(sys.argv[2])" $d/D.3mf $d/D.stl
(cd $S/three && node $H/ldraw-oracle.mjs $L rt-$n.dat $d/three.json 2>/dev/null)
perl $S/oracles/kristov_ldraw2stl/bin/dat2stl --file $L/parts/rt-$n.dat --ldrawdir $L > $d/kristov.stl 2>/dev/null
echo "== $n ($in) -> $(grep -c '^3 ' $L/parts/rt-$n.dat) tris, $(grep -c '^2 ' $L/parts/rt-$n.dat) edge lines, $(grep -c '^5 ' $L/parts/rt-$n.dat) cond lines"
printf '  dat->stl->dat->stl  '; node $H/cmp2.mjs $d/A.stl $d/C.stl stl
printf '  .dat via three.js   '; node $H/cmp2.mjs $d/A.stl $d/three.json ldu
printf '  .dat via kristov    '; node $H/cmp2.mjs $d/A.stl $d/kristov.stl mm-ldraw
printf '  3mf via trimesh     '; node $H/cmp2.mjs $d/A.stl $d/D.stl stl
