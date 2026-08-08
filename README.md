# Smart MCQ Solver using Deep Learning and Transformer Models

## Project Overview

This project was developed as part of the IIT Madras BS Degree in Data Science and Applications (DL GenAI Project).

The objective is to solve a **multiple-choice question (MCQ) ranking problem**, where the model predicts the **Top-3 most relevant options** for each question instead of only the single best answer.

Unlike a conventional multi-class classification problem, the task was formulated as a **binary relevance ranking problem**, where every Question–Option pair is evaluated independently and assigned a relevance score.

The final predictions are ranked according to these scores and evaluated using the **MAP@3 (Mean Average Precision @3)** metric.

---

# Problem Statement

Given:

- A question
- Five candidate answers (A–E)

Predict:

- The **Top-3 most likely correct answers**

Evaluation Metric:

- **MAP@3**

---

# Approach

Multiple NLP architectures were implemented and compared to understand their effectiveness on the ranking task.

## 1. Traditional Machine Learning Baseline

- TF-IDF Vectorization
- Logistic Regression

Purpose:

- Establish a lexical baseline
- Compare traditional ML against deep learning models

---

## 2. Transformer-Based Models

The project evaluates several pretrained transformer architectures:

- Cross Encoder
- BERT
- RoBERTa
- DeBERTa

The transformer models were fine-tuned on the competition dataset using binary relevance classification.

Each Question–Option pair was converted into:

```
Question + Option
        ↓
Relevant (1) / Not Relevant (0)
```

Loss Function:

- BCEWithLogitsLoss

Prediction:

- Sigmoid probability
- Rank options by probability
- Select Top-3

---

## 3. Retrieval-Augmented Generation (RAG)

A Retrieval-Augmented Generation pipeline was also explored to study retrieval-based NLP architectures.

Components included:

- Knowledge Base
- Embedding Generation
- Similarity Search
- Retrieved Context
- Response Generation

This was evaluated as an alternative approach for context-aware question answering.

---

## 4. Custom Deep Learning Model

A custom neural architecture was implemented from scratch using PyTorch.

Architecture:

```
Embedding Layer
        ↓
BiLSTM
        ↓
Attention Layer
        ↓
Linear Layer
        ↓
Sigmoid
```

The attention layer enables the model to focus on the most relevant contextual hidden states produced by the BiLSTM.

---

# Why Binary Relevance?

Instead of treating the problem as a 5-class classification problem, it was reformulated into binary relevance classification because:

- Each option can independently be evaluated against the question.
- Produces relevance scores directly.
- Better aligned with MAP@3 ranking.
- Easily scalable to any number of answer options.

---

# Model Evaluation

Evaluation Metric:

- MAP@3

Experiments included:

- TF-IDF + Logistic Regression
- Cross Encoder
- BERT
- RoBERTa
- DeBERTa
- BiLSTM
- BiLSTM + Attention

Hyperparameter tuning was performed to optimize:

- Learning Rate
- Batch Size
- Maximum Sequence Length
- Number of Epochs

---

# Deployment

The deployed application uses the fine-tuned **BERT model** for inference.

Reasons for choosing BERT:

- Strong leaderboard performance
- Stable generalization
- Mature Hugging Face ecosystem
- Efficient deployment
- Minimal performance difference compared to the custom BiLSTM model

The application is built using:

- Streamlit
- Hugging Face Transformers
- PyTorch

Large model weights are hosted separately on the Hugging Face Model Hub to avoid GitHub's file size limitations.

---

# Repository Structure

```
deployment/
│
├── app.py                 # Streamlit application
├── inference.py           # Prediction pipeline
├── config.py              # Configuration
├── requirements.txt
├── tokenizer/
│   ├── tokenizer.json
│   └── tokenizer_config.json
│
└── model/
    └── best_bert_model.pt
```

---

# Technologies Used

- Python
- PyTorch
- Hugging Face Transformers
- Streamlit
- Scikit-Learn
- Pandas
- NumPy
- Kaggle
- Jupyter Notebook

---

# Key NLP Concepts Used

- Binary Relevance Classification
- TF-IDF
- Logistic Regression
- Self-Attention
- Cross Encoder
- Transformer Models
- BERT
- RoBERTa
- DeBERTa
- Retrieval-Augmented Generation (RAG)
- BiLSTM
- Attention Mechanism
- BCEWithLogitsLoss
- Sigmoid
- MAP@3

---

# Future Improvements

Possible extensions include:

- LoRA / Parameter-Efficient Fine-Tuning
- Hybrid Retrieval (BM25 + Dense Embeddings)
- Ensemble Learning
- Hyperparameter Optimization
- Model Quantization
- ONNX Deployment
- DistilBERT for Faster Inference

---

# Author

**Nishant S. Kuttan - 24f1002494**

IIT Madras BS Degree Program

Course: Deep Learning and Generative AI Project
