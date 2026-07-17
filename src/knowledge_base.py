"""
knowledge_base.py

Provides services for building, saving and loading
the Knowledge Base used by the RAG pipeline.

Author:
    Nishant S Kuttan

Project:
    Deep Learning & Generative AI Project
"""

import pandas as pd

from src.logger import get_logger

logger = get_logger(__name__)


class KnowledgeBaseService:
    """
    Service responsible for creating and managing
    the Knowledge Base.
    """

    def __init__(self):
        self.knowledge_base = None

    def build(self, dataframe: pd.DataFrame) -> list[str]:
        """
        Build the knowledge base from the training dataset.

        Parameters
        ----------
        dataframe : pd.DataFrame
            Training dataframe.

        Returns
        -------
        list[str]
            Knowledge base documents.
        """

        logger.info("Building Knowledge Base...")

        knowledge_base = []

        for _, row in dataframe.iterrows():
            correct_letter = row["answer"]
            knowledge_base.append(str(row[correct_letter]))

        self.knowledge_base = knowledge_base

        logger.info(
            "Knowledge Base built successfully with %d documents.",
            len(self.knowledge_base),
        )

        return self.knowledge_base


    def get_documents(self) -> list[str]:
        """
        Return the loaded Knowledge Base.
        """

        if self.knowledge_base is None:
            raise ValueError(
                "Knowledge Base is not available."
            )

        return self.knowledge_base

    def size(self) -> int:
        """
        Return the number of documents in the Knowledge Base.
        """

        if self.knowledge_base is None:
            raise ValueError(
                "Knowledge Base is not available."
            )

        return len(self.knowledge_base)