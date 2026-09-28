# Model Improvement Plan — Planning Only

Current evidence is insufficient for qualification and the earlier non-independent check was weak, especially for CCW. Do not retrain until the independent set is collected and reviewed.

If the held-out set fails, inspect class balance and label consistency; add smartphone captures, installed-propeller views, reflections, cluttered backgrounds, oblique angles and other hard examples. Start with at least 100 new hard examples per failure-dominant class/condition, separated into training and a never-trained qualification set.

CW versus CCW may be visually ambiguous across face/orientation. After error review, consider an explicitly labeled `CW_F`, `CCW_F`, `CW_B`, `CCW_B` model rather than inferring face from two classes. Do not automatically relabel all existing roughly 500 images: audit a stratified sample first, define face labeling rules, then estimate the full relabel effort and inter-annotator agreement.

