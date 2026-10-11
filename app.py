#!/usr/bin/env python3
"""Linux Dashboard: native desktop control, system monitoring, and an agentic AI assistant."""
import sys
from pathlib import Path

# Add src/ to module search path so internal modules load cleanly
_SRC = Path(__file__).resolve().parent / "src"
if _SRC.is_dir():
    sys.path.insert(0, str(_SRC))

from dashboard import main

if __name__ == "__main__":
    sys.exit(main())
