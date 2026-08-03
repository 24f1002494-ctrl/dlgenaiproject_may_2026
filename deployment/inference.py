import torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification

from config import *

# Load tokenizer
tokenizer = AutoTokenizer.from_pretrained(TOKENIZER_PATH)

# Load model architecture
model = AutoModelForSequenceClassification.from_pretrained(
    MODEL_NAME,
    num_labels=1
)

# Load fine-tuned weights
model.load_state_dict(
    torch.load(MODEL_PATH, map_location=DEVICE)
)

model.to(DEVICE)
model.eval()


def predict(question, options):

    scores = []

    with torch.no_grad():

        for option in options:

            encoding = tokenizer(
                question,
                option,
                truncation=True,
                padding="max_length",
                max_length=MAX_LEN,
                return_tensors="pt"
            )

            input_ids = encoding["input_ids"].to(DEVICE)
            attention_mask = encoding["attention_mask"].to(DEVICE)

            outputs = model(
                input_ids=input_ids,
                attention_mask=attention_mask
            )

            score = torch.sigmoid(outputs.logits).item()

            scores.append(score)

    ranking = sorted(
        zip(["A", "B", "C", "D", "E"], scores),
        key=lambda x: x[1],
        reverse=True
    )

    return ranking