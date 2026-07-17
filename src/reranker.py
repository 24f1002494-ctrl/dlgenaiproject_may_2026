"""
reranker.py

Provides services for reranking retrieved documents
using a Cross Encoder.

Author:
    Nishant S Kuttan

Project:
    Deep Learning & Generative AI Project
"""

from typing import List

from sentence_transformers import CrossEncoder

from src.logger import get_logger

logger = get_logger(__name__)

class RerankerService:
    """
    Service responsible for reranking
    retrieved documents.
    """

    def __init__(
        self,
        model_name: str,
    ):

        logger.info(
            "Loading Cross Encoder model: %s",
            model_name,
        )

        self.model = CrossEncoder(model_name)

        logger.info(
            "Cross Encoder loaded successfully."
        )

    def rerank(
        self,
        query: str,
        retrieved_indices: List[int],
        knowledge_base: List[str],
    ) -> List[dict]:
        """
        Rerank retrieved documents.

        Parameters
        ----------
        query : str
            User query.

        retrieved_indices : List[int]
            Retrieved document indices.

        knowledge_base : List[str]
            Knowledge base.

        Returns
        -------
        List[dict]
            Ranked retrieval results.
        """

        if not query.strip():
            raise ValueError("Query cannot be empty.")

        if not retrieved_indices:
            raise ValueError(
                "Retrieved indices cannot be empty."
            )

        logger.info(
            "Reranking %d retrieved documents.",
            len(retrieved_indices),
        )

        documents = [
            knowledge_base[index]
            for index in retrieved_indices
        ]

        pairs = [
            [query, document]
            for document in documents
        ]

        scores = self.model.predict(pairs)

        ranked_results = []

        for index, document, score in zip(
            retrieved_indices,
            documents,
            scores,
        ):
            ranked_results.append(
                {
                    "index": int(index),
                    "document": document,
                    "score": float(score),
                }
            )

        ranked_results.sort(
            key=lambda result: result["score"],
            reverse=True,
        )

        logger.info(
            "Reranking completed."
        )

        return ranked_results