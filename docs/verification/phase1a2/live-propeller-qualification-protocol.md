# Live Propeller Qualification Protocol

## Dataset boundary

Create a permanently held-out smartphone dataset with at least 30 new CW and 30 new CCW images. No image may come from, duplicate, or be derived from the training/validation corpus. Do not train on this set after evaluation.

For each class cover three distances, three to five angles, multiple backgrounds, ordinary indoor light, partial reflections, handheld and tabletop presentation, installation on F450, and both visible faces where practical. The current model is assessed only for CW versus CCW; face metadata does not imply four-class capability.

## Evidence fields

Each manifest row records image ID, relative path, ground truth, distance, angle, background, lighting, handling, installation state, face and notes. The qualification output adds predicted class, confidence, box, detected flag, correctness and error category.

Errors are grouped as CW→CCW, CCW→CW, propeller→other class, no detection, low confidence, and—when a manually reviewed ground-truth box is later supplied—box misalignment. Analyze errors by the capture metadata rather than confidence alone.

## Threshold and gate

Evaluate 0.50, 0.60, 0.70 and 0.80. Report per-class precision/recall, overall accuracy, false positives/negatives and the confusion matrix. Qualification requires both recalls ≥85%, mutual CW/CCW misclassification ≤10%, and at least 30 valid independent images per class. Otherwise the result is `MODEL_NOT_QUALIFIED`.

Even a qualified model produces detection facts only. It cannot directly emit PASS/NG; safety decisions remain subject to teacher confirmation.

