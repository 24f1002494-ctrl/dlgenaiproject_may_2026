"""
retriever.py

Provides services for retrieving the most similar
documents from a FAISS index.

Author:
    Nishant S Kuttan

Project:
    Deep Learning & Generative AI Project
"""

from typing import Tuple

import numpy as np

from src.embeddings import EmbeddingService
from src.faiss_index import FaissIndexService
from src.logger import get_logger

logger = get_logger(__name__)

class RetrieverService:
    """
    Retrieves the Top-K most similar documents
    using sentence embeddings and FAISS.
    """

    def __init__(
        self,
        embedding_service: EmbeddingService,
        faiss_service: FaissIndexService,
    ):

        self.embedding_service = embedding_service
        self.faiss_service = faiss_service

    def retrieve(
        self,
        query: str,
        top_k: int,
    ) -> Tuple[np.ndarray, np.ndarray]:
        """
        Retrieve the Top-K most similar documents.

        Parameters
        ----------
        query : str
            User query.

        top_k : int
            Number of documents to retrieve.

        Returns
        -------
        Tuple[np.ndarray, np.ndarray]
            distances, indices
        """

        if not query.strip():
            raise ValueError("Query cannot be empty.")

        logger.info("Embedding query.")

        query_embedding = self.embedding_service.generate(
            [query]
        )

        logger.info("Searching FAISS index.")

        distances, indices = self.faiss_service.search(
            query_embedding,
            top_k,
        )

        logger.info(
            "Retrieved %d documents.",
            top_k,
        )

        return distances, indices