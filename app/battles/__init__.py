"""1v1 pronunciation battle feature.

Adds an in-memory room store, scoring, HTTP, and WebSocket routes for
real-time head-to-head pronunciation practice. Nothing in this package
touches the existing pronunciation pipeline; analysis still happens via
the standard `POST /analyze` route, which both clients call directly.
"""
