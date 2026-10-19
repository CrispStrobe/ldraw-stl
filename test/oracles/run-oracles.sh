#!/bin/sh
# run-oracles.sh <part...> : produce mine-lo/mine-hi/three/kristov/lego2stl meshes per part
S=${ORACLE_WORK:?set ORACLE_WORK to the oracle work dir (see README.md)}
H=$(cd "$(dirname "$0")" && pwd); TOOL=$H/../../src/cli.mjs
for p in "$@"; do
  d=$S/cmp/$p; mkdir -p $d
  node $TOOL dat2stl $p.dat -o $d/mine-lo.stl --no-repair --weld 0.000001 >/dev/null
  node $TOOL dat2stl $p.dat -o $d/mine-hi.stl --no-repair --weld 0.000001 --hires >/dev/null
  (cd $S/three && node $H/ldraw-oracle.mjs $S/lib/ldraw $p.dat $d/three.json 2>/dev/null) || echo "three failed $p"
  perl $S/oracles/kristov_ldraw2stl/bin/dat2stl --file $S/lib/ldraw/parts/$p.dat --ldrawdir $S/lib/ldraw --cache > $d/kristov.stl 2>$d/kristov.err || echo "kristov failed $p"
  $S/venv/bin/python -I $H/lego2stl_oracle.py $S/oracles $S/lib/ldraw $p.dat $d/lego2stl.json 2>$d/lego2stl.err || echo "lego2stl failed $p"
done
