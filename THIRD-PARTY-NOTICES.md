# Third-party notices

ldraw-stl itself is licensed under the Mozilla Public License 2.0 (see `LICENSE`).
It does not relicense anything below; each component keeps its own licence.

## three.js 0.170.0 (web app only)

Shipped unmodified in the web app (`vendor/three/`): the renderer and `OrbitControls`.
https://threejs.org

```
The MIT License

Copyright © 2010-2024 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## LDraw.org Parts Library (web app mirror, and every converted mesh)

Source: https://library.ldraw.org/library/updates/complete.zip (the update date and SHA-256
of the copy in use are in `library/manifest.json` and in the app's About dialog).

Licence: every mirrored file carries a `0 !LICENSE` line, either
`Licensed under CC BY 4.0 : see CAreadme.txt` or
`Licensed under CC BY 2.0 and CC BY 4.0 : see CAreadme.txt`.

- CC BY 4.0: https://creativecommons.org/licenses/by/4.0/ (full text: `library/CAlicense4.txt`)
- CC BY 2.0: https://creativecommons.org/licenses/by/2.0/ (full text: `library/CAlicense.txt`)
- LDraw.org's explanation: `library/CAreadme.txt`

What the mirror holds: `parts/` (without `parts/textures/`), `p/`, `LDConfig.ldr` and the three
licence documents above, unmodified (the original compressed bytes, repacked into one zip and
cut into chunks). Everything else in complete.zip (the mklist tools, sample models, textures and
alternative colour files) is not redistributed.

Converted meshes (STL, 3MF) are adaptations of library files, so every download names, for each
source file, the author(s), licence, source URL and the changes made (`<name>.credits.txt`; the
3MF carries the same text as `Metadata/credits.txt` and in its metadata). Keep these credits with
the mesh when you share it.

LDraw(TM) is a trademark of the Estate of James Jessiman. LEGO(R) is a trademark of the LEGO Group,
which does not sponsor, authorize or endorse this project. Not affiliated with LDraw.org.

## Used only for testing (not shipped)

The oracle harness in `test/oracles/` compares results with three.js `LDrawLoader` (MIT),
kristov/ldraw2stl (no licence stated, run as an external program only), davidmargol/lego2stl
(MIT), lib3mf (BSD-2-Clause) and trimesh (MIT). None of their code is part of ldraw-stl.
