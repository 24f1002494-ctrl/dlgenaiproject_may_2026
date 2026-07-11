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