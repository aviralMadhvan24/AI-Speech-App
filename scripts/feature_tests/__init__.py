"""End-to-end feature test harness for the Soft Skills platform.

Drives the real debate / group-discussion state machines and the real
scoring pipeline (LLM content scoring included) with a controlled corpus
of transcripts, so score behaviour can be verified across content types.

Run via ``python scripts/run_feature_tests.py``.
"""
