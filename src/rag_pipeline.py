"""
rag_pipeline.py

Provides the end-to-end Retrieval-Augmented Generation
(RAG) pipeline.

Author:
    Nishant S Kuttan

Project:
    Deep Learning & Generative AI Project
"""

from typing import List

from src.knowledge_base import KnowledgeBaseService
from src.retriever import RetrieverService
from src.reranker import RerankerService
from src.logger import get_logger

logger = get_logger(__name__)

class RAGPipeline:
    """
    End-to-end Retrieval-Augmented Generation pipeline.
    """

    def __init__(
    self,
    knowledge_base_service: KnowledgeBaseService,
    retriever_service: RetrieverService,
    reranker_service: RerankerService,
    ):

        self.knowledge_base_service = knowledge_base_service
        self.retriever_service = retriever_service
        self.reranker_service = reranker_service

    def retrieve_context(
        self,
        query: str,
        top_k: int,
    ) -> List[dict]:
        """
        Retrieve and rerank the most relevant documents.

        Parameters
        ----------
        query : str
            User query.

        top_k : int
            Number of documents to retrieve.

        Returns
        -------
        List[dict]
            Ranked documents.
        """

        logger.info(
            "Executing RAG pipeline."
        )

        _, indices = self.retriever_service.retrieve(
            query,
            top_k,
        )

        ranked_results = self.reranker_service.rerank(
            query=query,
            retrieved_indices=indices[0].tolist(),
            knowledge_base=self.knowledge_base_service.get_documents(),
        )

        logger.info(
            "RAG pipeline completed."
        )

        return ranked_results
    
    def _match_documents_to_options(
        self,
        ranked_results: List[dict],
        question_row,
        top_k: int = 3,
    ) -> List[str]:
        """
        Match reranked documents back to
        answer option labels.
        """

        predictions = []
        seen = set()

        option_labels = [
            "A",
            "B",
            "C",
            "D",
            "E",
        ]

        for result in ranked_results:

            document = result["document"]

            for label in option_labels:

                if document == str(question_row[label]):

                    if label not in seen:
                        predictions.append(label)
                        seen.add(label)

                    if len(predictions) == top_k:
                        return predictions

                    break

        # Fallback: fill remaining choices
        for label in option_labels:
            if label not in seen:
                predictions.append(label)

            if len(predictions) == top_k:
                break

        return predictions
    
    def predict(
        self,
        question_row,
        top_k: int = 3,
    ) -> List[str]:
        """
        Predict the Top-K answer options
        for a question.
        """

        logger.info(
            "Predicting answer options."
        )

        ranked_results = self.retrieve_context(
            query=str(question_row["prompt"]),
            top_k=top_k,
        )

        predictions = self._match_documents_to_options(
            ranked_results,
            question_row,
            top_k=top_k,
        )

        logger.info(
            "Prediction completed."
        )

        return predictions[:top_k]