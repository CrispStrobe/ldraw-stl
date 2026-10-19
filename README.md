# ldraw-stl

Turn LDraw parts and minifigures into watertight STL and 3MF files for 3D printing, at 1:1
scale, and STL files back into LDraw parts. In the browser or on the command line.

**Web app: https://crispstrobe.github.io/ldraw-stl/**: search the whole
[LDraw.org Parts Library](https://library.ldraw.org) (about 23,700 parts) with autocomplete,
build a minifigure from headwear, head, torso and legs, or open your own `.ldr`/`.mpd` from
Studio or LeoCAD. Preview in 3D, then download STL, a coloured 3MF, or one STL per colour.
Everything runs in your browser; your files are never uploaded.

## What you get

- **Closed solids.** LDraw geometry is a surface model full of T-junctions and studs that sit
  on uncut faces. Every part is welded, its T-junctions split and its open loops capped, then
  checked: each part shell is closed and its normals point outwards (positive signed volume).
  Parts that touch, like a head on its neck stud, stay separate shells, and the slicer merges them.
  In a sweep over every 10th library part (2,370 parts, `test/sweep.mjs`), 80% of part shells
  come out closed, and 85% of minifigure parts are closed completely. The rest (mostly Technic, electric and
  Duplo parts, stickers) keep small gaps that Bambu Studio and PrusaSlicer repair when importing.
- **1:1 in millimetres.** 1 LDU = 0.4 mm, Z up, standing centred on the plate. STL has no unit,
  and Bambu Studio, PrusaSlicer and OrcaSlicer read it as millimetres, so a 2 x 4 brick imports at
  32.0 x 16.0 x 11.2 mm and a minifigure at about 40 mm. If a slicer ever offers to convert
  units, decline.
- **Colours in 3MF.** Every triangle keeps its LDraw colour, including printed torsos and faces.
  They are stored as standard 3MF `basematerials` and as filament painting for Bambu Studio and
  OrcaSlicer (`paint_color`) and PrusaSlicer (`mmu_segmentation`). Filament 1 is the largest
  colour by area.
- **STL to LDraw.** An `.stl` becomes an LDraw part (`0 BFC CERTIFY CCW`) with edge lines and
  optional conditional lines.

### Nominal vs. real dimensions

LDraw models the design grid: an 8 mm stud pitch, a 9.6 mm brick, a 3.2 mm plate, 4.8 mm studs.
Real LEGO elements are moulded slightly smaller so that they fit together: a 2 x 4 brick is about
31.8 x 15.8 mm, and real studs are a little taller (about 1.7 mm against LDraw's 1.6 mm). For a
display figure, print at 1:1. For printed parts that must clutch real bricks, expect to tune your
printer's horizontal expansion or scale slightly.

## Command line

Needs Node 20 or newer and the LDraw library: the official
[complete.zip](https://library.ldraw.org/library/updates/complete.zip), read in place, or an
extracted library folder. The library is looked up in `$LDRAW_LIB`, `~/.cache/ldraw/complete.zip`,
BrickStore's cache and `~/ldraw`, or you pass it with `--lib`.

```sh
npx github:CrispStrobe/ldraw-stl dat2stl 3001.dat -o brick.stl          # a library part
node src/cli.mjs dat2stl examples/minifig-train.ldr -o train.3mf         # coloured 3MF
node src/cli.mjs dat2stl examples/minifig-office.ldr -o office.stl --split-colors
node src/cli.mjs dat2stl my-model.mpd -o model.stl --scale 2 --hires
node src/cli.mjs stl2dat thing.stl -o thing.dat --condlines --author "Your Name"
node src/cli.mjs find "minifig hair"
```

`dat2stl` writes `<name>.credits.txt` next to every STL (see below). Run
`node src/cli.mjs --help` for all options.

## Licences and attribution

- **ldraw-stl** is free software under the [Mozilla Public License 2.0](LICENSE).
- **The LDraw.org Parts Library** is licensed under
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Some files are under
  [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) and CC BY 4.0, as stated on each
  file's `!LICENSE` line (see `CAreadme.txt` in the library). LDraw.org treats a converted 3D mesh
  as an adaptation; only 2D renders are exempt. So **every mesh this tool makes carries its
  credits**: for each library file used, its author(s), licence, source URL, and the changes made.
  The STL download is a zip with `<name>.credits.txt`, the 3MF holds the same text as
  `Metadata/credits.txt` and in its metadata, and the CLI writes the `.credits.txt` file. Keep
  the credits with the mesh when you share it.
- **The web app's library mirror** holds only the CC BY files of complete.zip: `parts/` without
  textures, `p/`, `LDConfig.ldr` and the licence documents (`CAreadme.txt`, `CAlicense.txt`,
  `CAlicense4.txt`). They are unmodified: the original compressed bytes, repacked and cut into
  chunks for range requests. The mklist tools, sample models and textures in complete.zip are not
  redistributed. CI refreshes the mirror weekly from library.ldraw.org.
- **three.js** (MIT) is shipped in the web app. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

LDraw™ is a trademark of the Estate of James Jessiman. LEGO® is a trademark of the LEGO Group,
which does not sponsor, authorize or endorse this project. Not affiliated with LDraw.org.

## Development

```sh
npm install
LDRAW_LIB=/path/to/complete.zip npm test                                    # unit + regression tests
node scripts/build-library.mjs /path/to/complete.zip dist && node scripts/build-web.mjs dist
node scripts/serve.mjs dist 8080                                           # http://localhost:8080/
node test/e2e/smoke.mjs dist                                               # Chromium smoke test
LDRAW_LIB=/path/to/complete.zip node test/sweep.mjs 10                     # every 10th library part
```

`src/core/` is shared by the CLI and the browser (no Node APIs). `test/oracles/` compares the
output with independent implementations: three.js `LDrawLoader`, kristov/ldraw2stl,
davidmargol/lego2stl, lib3mf and trimesh. Triangle counts, areas, bounding boxes and orientation
match on the tested parts; see its README.
