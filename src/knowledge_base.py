"""
knowledge_base.py

Description:
Builds and validates the Knowledge Base used by
the Retrieval-Augmented Generation pipeline.

Author:
Nishant S Kuttan

Project:
Deep Learning & Generative AI Project
"""

from typing import List
import pandas as pd

from pandas import *

def build_knowledge_base(train_df: pd.DataFrame) -> List[str]:
    """
    Build the Knowledge Base using the correct answers
    from the training dataset.

    Parameters
    ----------
    train_df : pd.DataFrame
        Training dataset.

    Returns
    -------
    List[str]
        List containing the correct answer text
        for every question.
    """

    knowledge_base = []

    for _, row in train_df.iterrows():

        correct_option = row["answer"]

        correct_document = str(row[correct_option])

        knowledge_base.append(correct_document)

    return knowledge_base