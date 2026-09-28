# Live Propeller Qualification Set

This directory is reserved for an independent smartphone-captured qualification set. Do not copy training, validation, or previously trained-on images here.

Collect at least 30 `cw_propeller` and 30 `ccw_propeller` images. Cover three distances, three to five angles, multiple backgrounds, normal indoor light, partial reflection, handheld/tabletop/F450-installed states, and both visible faces where practical. Face is metadata only; the current model is evaluated only for CW versus CCW.

Place images below `images/` and add one row per image to `manifest.csv`. Keep this set permanently excluded from training. Run:

`python tools/qualify_live_propellers.py --manifest qualification/live_propellers/manifest.csv --model <best.pt> --output docs/verification/phase1a2-model-qualification.json`

Qualification requires at least 30 existing images per class, recall of at least 85% for both classes, and mutual CW/CCW misclassification of at most 10%. Missing data or a missed threshold produces `MODEL_NOT_QUALIFIED`.

