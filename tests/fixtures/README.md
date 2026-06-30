# Test Fixtures

Small, deterministic audio files used by the test suite. These are committed to the repository so tests can run offline without any download step.

## Files

### `short_sample.wav`

A 1.5-second 440 Hz sine wave (A4) used by the fixture-backed audio preprocessing test.

| Property      | Value          |
| ------------- | -------------- |
| Duration      | 1.5 s          |
| Sample rate   | 16 000 Hz      |
| Channels      | 1 (mono)       |
| Bit depth     | 16-bit PCM     |
| Approx. size  | ~48 KB         |

## Regenerating

The fixture is produced by `scripts/generate_sample_audio.py`. The generator is deterministic, so re-running it overwrites the file with byte-identical content.

From the repository root:

```bash
python scripts/generate_sample_audio.py
```

The script depends only on `numpy` and `soundfile`, both already pinned in `requirements.txt`.

To verify the file after regeneration:

```python
import soundfile as sf

info = sf.info("tests/fixtures/short_sample.wav")
print(info.samplerate, info.channels, info.duration)
# 16000 1 1.5
```
