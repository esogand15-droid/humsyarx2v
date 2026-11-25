# -*- coding: utf-8 -*-
"""Shared pytest setup.

Lecture job tracking writes to MongoDB; unit tests run without a database,
so it is switched off by default here. tests/test_lecture_jobs.py exercises
the module directly with a mocked collection and is unaffected.
"""
import os

os.environ.setdefault("LECTURE_JOBS_ENABLED", "0")
