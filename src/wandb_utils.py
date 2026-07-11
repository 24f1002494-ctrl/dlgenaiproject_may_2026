"""
wandb_utils.py

Centralized Weights & Biases initialization.
"""

import wandb


def initialize_wandb(project_name: str,
                     experiment_name: str,
                     config: dict):

    run = wandb.init(
        project=project_name,
        name=experiment_name,
        config=config
    )

    return run