"""Make ``ml`` importable when scripts are run directly.

Keeps every script a plain ``python ml/scripts/<name>.py`` invocation without
requiring an editable install.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
