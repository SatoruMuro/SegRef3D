# Demo data licenses

SegRef3D software remains licensed under [Apache-2.0](../../LICENSE).
The following data licenses apply only to the respective demo image assets and their
adaptations, not to SegRef3D software. The data providers do not endorse SegRef3D.

## Abdominal DICOM CT: Pancreas-CT (TCIA) — CC BY 3.0

**Source:** The Cancer Imaging Archive (TCIA), **Pancreas-CT (Version 2)**.
One complete contrast-enhanced abdominal CT series, **PANCREAS_0080**, is included:
181 axial DICOM images, 512 × 512, 43,011,465-byte ZIP. Manual segmentation is not included.

**Dataset citation:** Roth H, Farag A, Turkbey EB, Lu L, Liu J, Summers RM.
*Data From Pancreas-CT (Version 2).* The Cancer Imaging Archive, 2016.
[DOI: 10.7937/K9/TCIA.2016.tNB1kqBU](https://doi.org/10.7937/K9/TCIA.2016.tNB1kqBU).

[Collection](https://www.cancerimagingarchive.net/collection/pancreas-ct/) ·
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) ·
[TCIA Data Usage Policy](https://www.cancerimagingarchive.net/data-usage-policies-and-restrictions/) ·
[Original TCIA license and policy notice](./pancreas-ct/LICENSE.txt) ·
[Asset manifest](./pancreas-ct/manifest.json).

Retain attribution, DOI, license and the TCIA data usage policy link when using or
redistributing these data; require downstream users to retain them too. Follow TCIA
restrictions, including no re-identification or contact of participants.

The official single-series ZIP, including LICENSE, is retained **byte-for-byte**.
No slices were removed, resampled, cropped or re-encoded. TCIA describes these DICOMs
as created from anonymized Analyze/NIfTI volumes, rather than original scanner exports.
The supplied geometry gives X/Y 0.9765625 mm and Z 1 mm (position-derived); these values
are preserved without substituting collection-level typical slice thickness.
In the demo, screen down is posterior (back) and slices run caudal to cranial
(LPS Z −180 to 0 mm). Decoded rows and slice order are reversed, with the affine
updated consistently for viewing, masks and exports. This is a lossless voxel
permutation, with no interpolation or change to the downloaded DICOM files.

The initial abdominal Window/Level (400/40) is a display-only preset; stored voxels
and source metadata are unchanged. Images download from this site only on selection
and are processed locally. SegCT/MRI request generation is local; Colab upload remains
an explicit separate user action.

Series UID: `1.2.826.0.1.3680043.2.1125.1.41202274843063370955090296887703130`.
Archive SHA-256: `6b9bff4c2a7bb77b564a13fb2fdcfa5a3afea25455ab066309fb5fce7c9a8065`.
All 181 DICOM files decode; SOP Instance UIDs are unique and slice positions form a
continuous 1 mm interval. The manifest records per-file hashes and positions.

## Electron microscopy: HeLa EM — CC0

Peddie CP, Jones ML, Collinson LM. *Cropped regions from Serial Block Face SEM of HeLa cell
pellet with 10 nm pixels and 50 nm slices (benchmark dataset)*, EMPIAR-10478.
[Source](https://doi.org/10.6019/EMPIAR-10478) ·
[CC0](https://creativecommons.org/publicdomain/zero/1.0/) ·
[EMPIAR licensing policy](https://www.ebi.ac.uk/empiar/policies/).

Only `ROI_1416-1932-171` is used. **150 slices are sampled every other frame from 300 slices**,
retaining source frames **1, 3, 5, ... 299** (including the first image). Images were resized
from 2000 x 2000 to 512 x 512 with LANCZOS and encoded as optimized 8-bit grayscale PNG.
No additional cropping, alignment, or contrast adjustment. Sequential output filenames:
`hela_0001.png`–`hela_0150.png`. Effective Z spacing is **100 nm**, twice the original 50 nm;
X/Y spacing remains 39.0625 nm. Image bytes: **25,418,095 (25.4 MB)**.
The manifest records the original frame number for every output image.

## Mouse brain — Light microscopy — CC BY-SA 4.0

- **Data source:** [Brain Architecture Project (BAP)](https://brainarchitecture.org/).
- **Dataset:** Mouse brain light microscopy / Mouse Brain Architecture Project.
- **License:** [Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)](https://creativecommons.org/licenses/by-sa/4.0/).
- **Policy:** [BAP License and Citation Policy](https://brainarchitecture.org/policies/), checked 2026-09-10.

The SegRef3D maintainer supplied this BAP-derived set via Dropbox. The supplied archive
contains only 132 PNG images and no README, dataset ID, brain ID, experiment ID, or physical
spacing metadata. No more specific identifier or stain is assigned here.

**Modifications:** all 132 supplied images are retained at 707 × 553 pixels and 8 bits per
RGB channel. Only their fully opaque alpha channel was removed, followed by optimized,
lossless PNG compression. Every RGB pixel was verified unchanged after encoding.
No downsampling, cropping, rotation, registration, contrast adjustment, or additional
slice selection was performed. Image bytes decrease from 62,713,760 to **51,472,513 (51.5 MB)**.
These BAP-derived assets, including the optimized images, remain **CC BY-SA 4.0**.

**Order and limitations:** original names `image0001.png`, `image0003.png`, …,
`image0263.png` are preserved in numeric order. The supplied set already omits all even
numbers; there are no additional gaps in this step-2 sequence. Natural and lexicographic
sorting agree for these zero-padded names. Contact sheets of all images show progressive
anatomy without an obvious reversal or abrupt ordering jump. Original section shifts,
tissue tears and slide artifacts remain. This review does not establish that every original
section is present. Source physical spacing metadata were not supplied. The demo starts
at slice 55 (`image0109.png`), visually selected for broad, clear left/right brain margins.
X/Y are calibrated by the user against an **approximate 11.4 mm adult mouse brain reference
width**, not a measurement of this BAP specimen. Z is an **estimated 0.10 mm (100 µm) effective
interval**: approximate 13.2 mm whole-brain AP coverage / 132 supplied images. It is not
source metadata or original histological section thickness. Physical volume remains unavailable
until XY calibration, and subsequent volumes are approximate. Register sections where necessary.

**Scientific citation (BAP):** Bohland JW et al. (2009).
*A Proposal for a Coordinated Effort for the Determination of Brainwide Neuroanatomical
Connectivity in Model Organisms at a Mesoscopic Scale.* PLoS Computational Biology
5(3): e1000334. <https://doi.org/10.1371/journal.pcbi.1000334>.
This is the project's general citation, not an invented identifier for this particular image set.

## Manifests and reproducibility

- [HeLa manifest](hela-em-demo/manifest.json): original TIFF checksum, original frame mapping,
  calibrated spacing, modifications and SHA-256 for every unchanged, reused demo PNG.
- [Mouse brain manifest](mouse-brain-demo/manifest.json): source archive and per-image hashes,
  source number mapping, output hashes, encoding settings and provenance limitations.

The HeLa 150-frame demo is reused byte for byte from the previously prepared SegRef3D demo.
To regenerate the mouse demo from the supplied archive (Python + Pillow):

```sh
python lite-web/scripts/prepare-mouse-brain-demo.py path/to/source.zip
node --test "lite-web/tests/*.test.mjs"
```

Original archives are not shipped. Images load only after a user selects a demo and can then
be cached by the browser. Microscopy demos start with empty masks each time they are selected;
export your work before switching. User-selected local images continue to be processed locally
without upload during normal SegRef3D Lite use.

## Existing Apple and RabbitCT demos

Their existing CC BY 4.0 credits, preparation details and citations are unchanged;
see the [Lite README](../README.md#apple-demo).
