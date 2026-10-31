# Experimental: malaria screening model

`malaria_model.onnx` + `malaria_labels.json` — EfficientNet-B0 trained on the NIH/NLM malaria cell images (Rajaraman 2018), split by patient.
Test (held-out patients): AUC 0.981, sensitivity 90.3%, specificity 98.2%, PPV 98.5% (threshold 0.428).

**Not enabled by default.** On cells cut automatically from whole slide photographs of malaria-free smears (Chula RBC-12),
the app's crops were flagged in 10–13% of red cells on some fields, against 1–2% with expert-centred crops: the model is
sensitive to how small red cells are cut out and enlarged. It needs calibration on detector-cut crops (ideally local
malaria-positive and negative films) before clinical-style use. It can be loaded by hand (Differential counter › Load model
files) for research; the app then labels its output "AI malaria screen" and never reports malaria without microscopy.
