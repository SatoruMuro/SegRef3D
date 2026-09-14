# 3D Preview camera and transparency

Implementation and Windows verification: 2026-09-14, against main `e130f02`.

## Causes and changes

The old preview constructed OrbitControls while the camera still had Three.js's
default Y-up, then changed to Z-up during reset. OrbitControls caches the up-axis
conversion in its constructor. It also preserves a fixed up axis, clamps the
polar angle, normalizes both drag axes by viewport height, and was configured
with damping. Together these explain the pole restriction, fast horizontal
rotation in wide viewports, and motion after release.

`preview-controls.mjs` replaces OrbitControls with a small camera controller.
Z-up is set before construction. Azimuth uses the current view-up; elevation uses
the current camera-right axis; view-up is transported and orthogonalized after
rotation. Each viewport dimension corresponds to 200 degrees. There are no
polar limits and no inertia. Reset restores the original oblique view and target
and cancels active pointer capture. Resize uses current CSS dimensions, separate
from device pixel ratio. The implementation follows the approach in
[VTK's TrackballCamera interactor](https://github.com/Kitware/VTK/blob/master/Interaction/Style/vtkInteractorStyleTrackballCamera.cxx).
Three.js TrackballControls was considered, but its virtual-ball rotation/roll is
less direct a match for that azimuth/elevation behavior.

| Input | Action |
| --- | --- |
| Left drag | Rotate |
| Middle drag / Shift-left | Pan |
| Right drag / Shift-Ctrl-left | Dolly |
| Wheel | Dolly, with pixel/line/page delta normalization |
| Ctrl-left / Command-left | Spin around the view axis using the angle about viewport center |
| One touch / two touches | Rotate / pan and pinch |

The context menu and touch-action changes apply only to the preview canvas.
Slicer differences remain: wheel scaling is tuned for browser input, the initial
view is SegRef3D's existing oblique view, there is no Slicer orientation widget,
camera picking, orthographic mode or Shift-right environment rotation. This is a
VTK-style controller, not a complete port of Slicer's interaction stack.

The old materials always used `transparent: true`, including at opacity 1, and
retained the default `depthWrite: true`. A translucent outer surface could thus
prevent a later internal surface from drawing. The opacity setter only changed
the numeric alpha. The new setter synchronizes transparent/depthWrite/depthTest,
invalidates the material when the transparent state changes, ignores nonfinite
inputs, and leaves object visibility independent. Opacity >= 0.999 is opaque.

## Why OIT is included

The vendored Three.js r185 already sorts transparent objects back to front by
their projected bounding-sphere centers on every render. That is preferable to
Euclidean center distance for projection depth, but cannot order nested or
intersecting triangles correctly. See the
[Three.js transparency explanation](https://threejs.org/manual/en/transparency.html).

After correcting depth writes, an opaque green sphere remained visible through
a 20% red shell from all tested directions. However, two intersecting 50%
transparent spheres still changed abruptly when their center sort order swapped.
For camera azimuth -0.0001 to +0.0001 radians, the largest mean-channel change in
the central 64x64 pixels was **71.43/255**. This is the reason for adding weighted
blended OIT rather than stopping at the material fix.

`preview-transparency.mjs` uses an opaque color/depth pass, additive half-float
weighted color accumulation, multiplicative revealage, and a final linear-color
composite with one output color conversion. Both translucent passes sample opaque
depth to reject occluded fragments. The original materials and visibility are
restored after each frame. MSAA uses a sample count supported by all target
formats. The method follows
[McGuire's implementation description](https://casual-effects.blogspot.com/2015/03/implemented-weighted-blended-order.html).

This adds no runtime dependencies and does not require WebGPU. If floating-point
color targets or complete framebuffers are unavailable, the viewer uses the
corrected conventional transparency path with the default sorting. No alphaHash
or dithering is used. Fully opaque scenes use the normal renderer directly.
Unchanged frames are not rendered, so idle previews incur no repeated OIT work.
Targets resize with the drawing buffer and all owned resources are disposed on
close. A restored WebGL context schedules a new frame.

## Automated verification

Run the full Lite suite from the repository root:

```sh
node --test "lite-web/tests/*.test.mjs"
```

**142/142 passed**, including existing mask, medical IO, segmentation, calibration,
interpolation, STL, storage/export, privacy and UI regressions. New tests cover
initial up/reset, fractional drags across resize, 360-degree pole crossings,
release/cancel/dispose, all mouse bindings, touch gestures, opacity transitions,
material invalidation, and unsupported OIT capabilities/framebuffers.

Browser tests use Playwright 1.62.1. It is only a test dependency:

```sh
npm install --no-save --package-lock=false playwright@1.62.1
npx playwright install chromium
node lite-web/tests/three-viewer.browser.mjs build/preview-qa/oit
OIT_FALLBACK=1 node lite-web/tests/three-viewer.browser.mjs build/preview-qa/fallback
```

On Windows, set environment variables using PowerShell's `$env:NAME='value'`.
`BROWSER_CHANNEL=chrome` or `msedge` selects an installed browser;
`PLAYWRIGHT_MODULE` may point to an existing `playwright/index.mjs`.
The Lite CI runs both rendering paths and saves JSON, screenshots and STL ZIPs.
Only the test server exposes renderer/camera references; production modules have
no debug globals.

Verified in **Chrome 152.0.7977.84** and **Edge 153.0.4234.32** on Windows:

- Nested surfaces: 72 azimuths at five elevations (including superior/inferior),
  for shell opacity 1, 0.5, 0.2, 0.1 and 0. Each sample is compared with the inner
  object hidden. At opacity 1 the inner contribution is exactly zero; at every
  other opacity it remains present at every direction and increases as the shell
  becomes more transparent. Hidden outer surfaces leave only the inner object.
- Overlap sorting: the center-order change falls from 71.43 to **0.0144/255**
  with OIT. Forcing opposite object draw orders over 360 degrees changes mean
  color by at most **0.0196/255** (floating-point rounding).
- Real mouse input: diagonal rotation, stopping without drift, pan via both
  bindings, right-drag dolly, wheel, Ctrl-spin, reset and viewport resize.
- Close/dispose/recreate: all owned geometry and target textures are released.
  The Three.js memory counter retains its own shared 16x16 DFG lighting texture.
- Real Apple demo: load all 20 original images, calibrate, draw compact nested
  labels on slices 9–11, generate **112,720 + 22,208 triangles**, change controls,
  close/reopen, and export two STL files. Binary STL triangle counts and lengths
  match the preview geometry exactly.
- Forced conventional fallback: the opaque-inside-translucent cases and mouse
  controls pass. The intersecting translucent color-order artifact remains, as
  expected, and is recorded rather than silently presented as solved.

A small synchronized rendering measurement (15 samples, 928x718 drawing buffer,
134,928 Apple-test triangles, one translucent and one opaque surface; includes
pixel readback) gave:

| Browser | Conventional median | OIT median | OIT maximum |
| --- | ---: | ---: | ---: |
| Chrome | 4.2 ms | 6.5 ms | 6.9 ms |
| Edge | 2.8 ms | 5.5 ms | 7.4 ms |

These are local measurements, not a throughput guarantee for other GPUs, high
pixel ratios or large anatomical datasets. OIT uses additional render targets
and bandwidth; idle rendering is explicitly tested to stop.

## Interactive checks and limitations

In the visible Chrome application, loaded the original Apple demo and drew
compact nested labels through the normal editor. Opened Preview 3D, tumbled
diagonally through the back and upper views, reset, adjusted outer opacity to
100%, 50%, 20%, 10%, hid the outside object, and closed/reopened the dialog.
The internal label stayed visible through the translucent outside and was
occluded at 100%. Separate sphere fixtures were also inspected and dragged.
Edge was exercised by the installed-browser automated workflow; the interactive
Edge connector was unavailable.

A separate stress attempt thresholded the entire original Apple image stack
twice (180 and 220) and generated both surfaces at 1x. The tab became unresponsive
during generation. The meshing/interpolation algorithms are unchanged by this
PR; this large, noisy-label workflow remains a limitation, and was not counted
as a successful preview test. Compact labels completed successfully. No actual
pelvis/levator-ani dataset was supplied; the visibility guarantee is tested with
synthetic nested/overlapping geometry and the described Apple labels.

Weighted OIT is approximate, not exact sorted alpha compositing or depth peeling.
It can soften depth/color separation between many nearly opaque translucent
layers. Back and front faces both contribute to opacity. Unsupported GPUs retain
the documented conventional sorting artifacts. Mobile/touch hardware, Safari,
Firefox and side-by-side interaction with a running Slicer were not tested.

## Changed files

- `three-viewer.mjs`: camera setup/reset, opacity/depth state, renderer integration,
  invalidation, resize and disposal.
- `preview-controls.mjs`: camera-local interaction controller.
- `preview-transparency.mjs`: weighted OIT and capability fallback.
- `app.mjs`: camera gesture help and versioned viewer import.
- `index.html`, `service-worker.js`: new asset generations and offline caching.
- `tests/preview-controls.test.mjs`, `tests/preview-transparency.test.mjs`,
  `tests/three-viewer.test.mjs`, `tests/ui-privacy.test.mjs`: unit/regression tests.
- `tests/three-preview-fixture.html`, `tests/three-viewer.browser.mjs`,
  `tests/three-preview-workflow.mjs`: rendered-pixel and real workflow checks.
- `.github/workflows/lite-web.yml`: browser regression CI and saved artifacts.
- This report. No vendor code, surface-generation or STL algorithms changed.
