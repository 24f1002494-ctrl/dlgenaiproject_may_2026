"""
config.py

Loads project configuration.
"""

from pathlib import Path
import yaml


CONFIG_PATH = Path(__file__).resolve().parent.parent / "configs" / "experiment.yaml"


def load_config():
    with open(CONFIG_PATH, "r") as f:
        return yaml.safe_load(f)


def get_embedding_model(config):
    return config["models"]["embedding"]


def get_zero_shot_model(config):
    return config["models"]["zero_shot"]


def get_reranker_model(config):
    return config["models"]["reranker"]


def get_top_k(config):
    return config["retrieval"]["top_k"]
