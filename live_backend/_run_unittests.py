"""Run live_backend unittest modules without pytest (no tests/__init__.py)."""
import sys
import unittest
from pathlib import Path

LIVE = Path(__file__).resolve().parent
sys.path.insert(0, str(LIVE / "tests"))
sys.path.insert(0, str(LIVE))

loader = unittest.TestLoader()
suite = unittest.TestSuite()
for name in sys.argv[1:]:
    suite.addTests(loader.loadTestsFromName(name))
result = unittest.TextTestRunner(verbosity=1).run(suite)
sys.exit(0 if result.wasSuccessful() else 1)
