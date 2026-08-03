from pathlib import Path
import torch

BASE_DIR = Path(__file__).resolve().parent

MODEL_NAME = "bert-base-uncased"

MODEL_PATH = BASE_DIR / "model" / "best_bert_model.pt"

TOKENIZER_PATH = BASE_DIR / "tokenizer"

MAX_LEN = 192

if torch.cuda.is_available():
    device = torch.device("cuda")
    print("Using NVIDIA GPU (CUDA)")
elif torch.backends.mps.is_available():
    device = torch.device("mps")
    print("Using Apple Silicon GPU (MPS)")
else:
    device = torch.device("cpu")
    print("Using CPU")
DEVICE = device