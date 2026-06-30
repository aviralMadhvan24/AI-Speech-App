from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch


DEFAULT_GOPT_DIR = Path("models/pronunciation/gopt")
DEFAULT_CHECKPOINT = (
    DEFAULT_GOPT_DIR
    / "pretrained_models"
    / "gopt_librispeech"
    / "best_audio_model.pth"
)
DEFAULT_FEATURE_DIR = Path("temp/gopt_features")


class GoptNotReady(RuntimeError):
    pass


@dataclass
class GoptPrediction:

    utterance_scores: dict

    phone_scores: list[float]

    word_scores: list[float]


class GoptAdapter:

    def __init__(
        self,
        gopt_dir: Path = DEFAULT_GOPT_DIR,
        checkpoint_path: Path = DEFAULT_CHECKPOINT,
        feature_dir: Path = DEFAULT_FEATURE_DIR
    ):
        self.gopt_dir = gopt_dir
        self.checkpoint_path = checkpoint_path
        self.feature_dir = feature_dir
        self._model = None

    def predict(self, analysis_id: str) -> GoptPrediction:
        feature_path = self.feature_dir / f"{analysis_id}_feat.npy"
        phone_path = self.feature_dir / f"{analysis_id}_phn.npy"

        self._ensure_ready(
            feature_path=feature_path,
            phone_path=phone_path
        )

        model = self._load_model()
        input_feat = np.load(feature_path)
        input_phn = np.load(phone_path)

        with torch.no_grad():
            t_input_feat = torch.from_numpy(input_feat[:, :, :]).float()
            t_phn = torch.from_numpy(input_phn[:, :, 0]).float()
            u1, u2, u3, u4, u5, p, w1, w2, w3 = model(
                t_input_feat,
                t_phn
            )

        return GoptPrediction(
            utterance_scores={
                "accuracy": self._to_score(u1),
                "completeness": self._to_score(u2),
                "fluency": self._to_score(u3),
                "prosody": self._to_score(u4),
                "total": self._to_score(u5)
            },
            phone_scores=self._sequence_scores(p),
            word_scores=self._sequence_scores(w3)
        )

    def _ensure_ready(self, feature_path: Path, phone_path: Path):
        if not self.gopt_dir.exists():
            raise GoptNotReady(
                f"GOPT repo is missing at {self.gopt_dir.as_posix()}."
            )

        if not self.checkpoint_path.exists():
            raise GoptNotReady(
                "GOPT checkpoint is missing. Expected "
                f"{self.checkpoint_path.as_posix()}."
            )

        if not feature_path.exists() or not phone_path.exists():
            raise GoptNotReady(
                "GOPT acoustic features are missing for this analysis. "
                "Run the Kaldi GOP feature extraction pipeline first."
            )

    def _load_model(self):
        if self._model is not None:
            return self._model

        src_path = self.gopt_dir / "src"

        if not src_path.exists():
            raise GoptNotReady(
                f"GOPT src directory is missing at {src_path.as_posix()}."
            )

        import sys

        src_path_text = str(src_path.resolve())

        if src_path_text not in sys.path:
            sys.path.append(src_path_text)

        from models import GOPT

        model = GOPT(
            embed_dim=24,
            num_heads=1,
            depth=3,
            input_dim=84
        )
        model = torch.nn.DataParallel(model)
        state_dict = torch.load(
            self.checkpoint_path,
            map_location="cpu"
        )
        model.load_state_dict(
            state_dict,
            strict=True
        )
        model = model.float()
        model.eval()
        self._model = model

        return self._model

    def _to_score(self, tensor):
        value = float(
            tensor.detach()
            .cpu()
            .reshape(-1)[0]
            .item()
        )

        return round(
            max(0, min(100, value * 50)),
            2
        )

    def _sequence_scores(self, tensor):
        values = (
            tensor.detach()
            .cpu()
            .reshape(-1)
            .tolist()
        )

        return [
            round(
                max(0, min(100, float(value) * 50)),
                2
            )
            for value in values
        ]
