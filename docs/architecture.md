# System Architecture

## Objective

Build a Retrieval-Augmented Generation (RAG) system capable of answering Multiple Choice Questions.

---

## Pipeline

Question

↓

Sentence Embedding

↓

FAISS Retrieval

↓

Top-K Documents

↓

Cross Encoder

↓

Best Context

↓

Prompt Builder

↓

Zero-shot Classifier

↓

Prediction

---

## Components

### Knowledge Base

Stores the correct answers extracted from the training dataset.

### Embedding Model

Converts text into dense semantic vectors.

### FAISS

Performs efficient nearest-neighbour search.

### Cross Encoder

Reranks retrieved documents based on semantic similarity.

### Zero-shot Classifier

Predicts the most probable answer using the retrieved context.

---

## Evaluation

The final system is evaluated using MAP@3.