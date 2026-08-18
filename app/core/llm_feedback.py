"""Helpers for turning raw LLM feedback into text that is safe to show a student.

Every scorer (debate, GD, interview) asks the model for feedback as a plain
string quoting the speaker's own words. Models do not always comply — the same
prompt can come back as a list of ``{quote, issue, fix}`` objects — so the
flattening lives here rather than being reimplemented per feature.
"""


def coerce_feedback(raw: object) -> str:
    """Flatten LLM feedback into one readable sentence-style string.

    The prompt asks for a plain string, but models sometimes return a list of
    ``{quote, issue, fix}`` objects instead. Passing that straight to ``str()``
    would surface a Python repr (``[{'quote': ...}]``) to the student, so the
    parts are joined into prose instead.
    """
    if isinstance(raw, str):
        return raw.strip()

    if isinstance(raw, dict):
        raw = [raw]

    if isinstance(raw, list):
        parts: list[str] = []
        for item in raw:
            if isinstance(item, str):
                parts.append(item.strip())
                continue
            if not isinstance(item, dict):
                continue
            quote = str(item.get("quote", "")).strip().strip('"')
            issue = str(item.get("issue", "")).strip()
            fix = str(item.get("fix", "")).strip()
            sentence = ""
            if quote:
                sentence = f"'{quote}'"
            if issue:
                sentence = f"{sentence} - {issue}" if sentence else issue
            if fix:
                sentence = f"{sentence}. {fix}" if sentence else fix
            if sentence:
                parts.append(sentence.rstrip(".") + ".")
        return " ".join(parts).strip()

    return str(raw).strip() if raw is not None else ""
