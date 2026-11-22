"""QC report (V1S-505): local ASR of dialogue windows, one JSON line per WAV.

Run by src/lib/server/qc.ts as:
    uv run --no-project --with faster-whisper python scripts/qc_asr.py a.wav b.wav
Uses faster-whisper "small" on the CPU (downloaded once into the Hugging Face cache).
"""
import json
import sys

from faster_whisper import WhisperModel

model = WhisperModel("small", device="cpu", compute_type="int8")
for path in sys.argv[1:]:
    segments, _ = model.transcribe(path, language="en", beam_size=5, temperature=0, vad_filter=False, condition_on_previous_text=False)
    print(json.dumps({"file": path, "text": " ".join(s.text.strip() for s in segments)}), flush=True)
