"""
faiss_index.py

Provides services for building, saving and loading
FAISS indices used by the Retrieval-Augmented
Generation pipeline.

Author:
    Nishant S Kuttan
"""

from pathlib import Path

import faiss
import numpy as np

from src.logger import get_logger

logger = get_logger(__name__)

class FaissIndexService:
    """
    Service responsible for creating and managing
    a FAISS index.
    """

    def __init__(self):

        self.index = None

    def build_index(
        self,
        embeddings: np.ndarray,
    ) -> None:
        """
        Build a FAISS index from embeddings.
        """

        if embeddings.size == 0:
            raise ValueError(
                "Embedding matrix is empty."
            )

        dimension = embeddings.shape[1]

        logger.info(
            "Building FAISS index..."
        )

        self.index = faiss.IndexFlatL2(
            dimension
        )

        self.index.add(embeddings)

        logger.info(
            "FAISS index contains %d vectors.",
            self.index.ntotal,
        )

    def save(
        self,
        output_path: Path,
    ) -> None:
        """
        Save the FAISS index.
        """

        if self.index is None:
            raise ValueError(
                "No FAISS index has been built."
            )

        output_path.parent.mkdir(
            parents=True,
            exist_ok=True,
        )

        faiss.write_index(
            self.index,
            str(output_path),
        )

        logger.info(
            "FAISS index saved successfully."
        )

    def load(
        self,
        index_path: Path,
    ) -> None:
        """
        Load a FAISS index.
        """

        self.index = faiss.read_index(
            str(index_path)
        )

        logger.info(
            "FAISS index loaded successfully."
        )

    def get_total_vectors(self) -> int:
        """
        Return the number of vectors
        stored in the index.
        """

        if self.index is None:
            raise ValueError(
                "FAISS index not loaded."
            )

        return self.index.ntotal