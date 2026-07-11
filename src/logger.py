"""
logger.py

Central logging configuration for the project.
"""

import logging
from pathlib import Path


def get_logger(name: str) -> logging.Logger:
    log_dir = Path("outputs/logs")
    log_dir.mkdir(parents=True, exist_ok=True)

    logger = logging.getLogger(name)

    if not logger.handlers:
        logger.setLevel(logging.INFO)

        formatter = logging.Formatter(
            "%(asctime)s | %(levelname)s | %(name)s | %(message)s"
        )

        # Console handler
        console = logging.StreamHandler()
        console.setFormatter(formatter)

        # File handler
        file_handler = logging.FileHandler(log_dir / "project.log")
        file_handler.setFormatter(formatter)

        logger.addHandler(console)
        logger.addHandler(file_handler)

    return logger