"""
embeddings.py

Generate and manage sentence embeddings
for the Retrieval-Augmented Generation pipeline.
"""

"""
embeddings.py

Sentence embedding services for the RAG pipeline.

Author:
    Nishant S Kuttan

Project:
    Deep Learning & Generative AI Project
"""

from pathlib import Path
from typing import List
import numpy as np
from sentence_transformers import SentenceTransformer
from src.logger import get_logger

logger = get_logger(__name__)

class EmbeddingService:
    """
    Handles embedding generation using Sentence Transformers.
    """

    def __init__(self, model_name: str):

        logger.info(
            "Loading embedding model: %s",
            model_name
        )

        self.model = SentenceTransformer(model_name)

        logger.info("Embedding model loaded.")

    def generate(
            self,
            documents: List[str]
        ) -> np.ndarray:
        """
            Generate embeddings for documents.
        """

        if not documents:
            raise ValueError(
                "Document list is empty."
            )

        logger.info(
            "Generating embeddings for %d documents.",
                len(documents)
        )

        embeddings = self.model.encode(
            documents,
            show_progress_bar=True,
            convert_to_numpy=True
        )

        logger.info("Embedding generation completed.")

        return embeddings

    def save(
            self,
            embeddings: np.ndarray,
            output_path: Path
        ) -> None:

        output_path.parent.mkdir(
            parents=True,
            exist_ok=True
        )

        np.save(output_path, embeddings)

        logger.info(
            "Embeddings saved to %s",
            output_path
        )

    def load(
            self,
            embedding_path: Path
        ) -> np.ndarray:

        logger.info(
            "Loading embeddings from %s",
            embedding_path
        )

        return np.load(embedding_path)