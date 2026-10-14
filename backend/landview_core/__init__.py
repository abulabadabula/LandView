"""LandView core: pure-Python site, geometry and compliance logic.

Rule: nothing in this package may import FastAPI, httpx request handlers or any
web framework. Routers in ``app`` stay thin and call into here.
"""
