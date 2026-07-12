"""
Project bootstrap utilities.
"""

import sys
from pathlib import Path

def setup_project():
    """
    Configure the Python path so notebooks can import modules from src/.
    """
    project_root = Path.cwd().parent

    if str(project_root) not in sys.path:
        sys.path.insert(0, str(project_root))

    return project_root

def get_data_directory(project_root: Path) -> Path:
    """
    Return the raw data directory.
    """
    return project_root / "data" / "raw"


def get_output_directory(project_root: Path) -> Path:
    """
    Return the output directory.
    """
    output_dir = project_root / "outputs"
    output_dir.mkdir(parents=True, exist_ok=True)
    return output_dir


def get_logs_directory(project_root: Path) -> Path:
    """
    Return the logs directory.
    """
    log_dir = project_root / "outputs" / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    return log_dir