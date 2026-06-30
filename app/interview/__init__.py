"""Interview Studio backend.

Proxies video uploads to the ss3 Communication Skills Analyzer running
on a separate Python 3.11 conda env (MediaPipe doesn't work on 3.13).
This package owns only the HTTP shim, scoring fusion, and the route —
all the heavy gesture analysis lives in ss3.
"""
