import streamlit as st
from inference import predict

st.set_page_config(
    page_title="LLM Science Exam Solver",
    page_icon="🧠"
)

st.title("🧠 LLM Science Exam Solver")

st.write(
    "This application uses a fine-tuned BERT model to rank the five answer choices for a multiple-choice question."
)

question = st.text_area("Question")

option_a = st.text_input("Option A")
option_b = st.text_input("Option B")
option_c = st.text_input("Option C")
option_d = st.text_input("Option D")
option_e = st.text_input("Option E")

if st.button("Predict Top 3"):

    options = [
        option_a,
        option_b,
        option_c,
        option_d,
        option_e
    ]

    ranking = predict(question, options)

    st.subheader("Top 3 Predictions")

    medals = ["🥇", "🥈", "🥉"]

    for medal, (option, score) in zip(medals, ranking[:3]):
        st.write(f"{medal} **Option {option}** — {score:.4f}")