"""Subject classifier for council bills.

Multi-label keyword classifier. A bill can fall in 0..N of:
  tax | transportation | food_security | affordable_housing

Designed to be high-recall: match against title + raw_subject, case-insensitive,
word-boundary regex. Tune by editing the dictionaries below.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from tracker.legislative import SUBJECTS

# Each entry is a regex pattern matched case-insensitively against
# (title + " " + raw_subject). Use \b word boundaries; allow short
# multi-word phrases as plain strings (escaped via re.escape).
_RULES: dict[str, list[str]] = {
    "tax": [
        r"\btax(es|ation|payer|payers)?\b",
        r"\breal property tax\b",
        r"\bproperty tax\b",
        r"\bTAT\b",
        r"\btransient accommodations?\b",
        r"\bGET\b",
        r"\bgeneral excise\b",
        r"\bexemption\b",
        r"\bassessment\b",
        r"\bsurcharge\b",
        r"\bfee\b",
        r"\brevenue bond\b",
        r"\bmillage\b",
    ],
    "transportation": [
        r"\bbus\b",
        r"\bTheBus\b",
        r"\bHandi-Van\b",
        r"\brail\b",
        r"\bskyline\b",
        r"\broad(way|s)?\b",
        r"\bhighway\b",
        r"\bstreet\b",
        r"\btraffic\b",
        r"\bbike|bicycle\b",
        r"\bpedestrian\b",
        r"\bparking\b",
        r"\bferry\b",
        r"\btransit\b",
        r"\bcomplete streets\b",
        r"\bspeed limit\b",
        r"\bcrosswalk\b",
        r"\bvehicle\b",
    ],
    "food_security": [
        r"\bfood\b",
        r"\bSNAP\b",
        r"\bWIC\b",
        r"\bEBT\b",
        r"\bhunger\b",
        r"\bagricultur(e|al)\b",
        r"\bfarm(ing|ers?|land)?\b",
        r"\bgrocer(y|ies)\b",
        r"\bfood bank\b",
        r"\bfood pantr(y|ies)\b",
        r"\bnutrition\b",
        r"\bcommunity garden\b",
        r"\bDA BUX\b",
        r"\baquaculture\b",
        r"\bfish(ery|eries|ing)\b",
    ],
    "affordable_housing": [
        r"\baffordable housing\b",
        r"\bhousing\b",
        r"\bADU\b",
        r"\baccessory dwelling\b",
        r"\bohana( unit| dwelling)?\b",
        r"\brent(al|s|er|ers)?\b",
        r"\bzoning\b",
        r"\bdensity\b",
        r"\bdevelopment\b",
        r"\bhomeless(ness)?\b",
        r"\bshelter\b",
        r"\bHUD\b",
        r"\bsection 8\b",
        r"\bvoucher\b",
        r"\binclusionary\b",
        r"\bLIHTC\b",
        r"\bworkforce housing\b",
        r"\bTOD\b",
        r"\btransit[- ]oriented\b",
    ],
}

_COMPILED: dict[str, list[re.Pattern]] = {
    subject: [re.compile(p, re.IGNORECASE) for p in patterns]
    for subject, patterns in _RULES.items()
}


@dataclass
class Classification:
    subjects: list[str]
    confidence: float
    matched_terms: dict[str, list[str]]


def classify(title: str | None, raw_subject: str | None = None) -> Classification:
    """Classify a bill into 0..N subject areas.

    confidence = (total distinct subject hits) / (number of subject categories),
    a coarse signal — high means multiple categories matched, low means just one.
    """
    haystack = " ".join(p for p in (title, raw_subject) if p)
    if not haystack.strip():
        return Classification(subjects=[], confidence=0.0, matched_terms={})

    matched: dict[str, list[str]] = {}
    for subject in SUBJECTS:
        hits = []
        for pat in _COMPILED[subject]:
            m = pat.search(haystack)
            if m:
                hits.append(m.group(0))
        if hits:
            matched[subject] = sorted(set(hits))

    subjects = [s for s in SUBJECTS if s in matched]
    confidence = sum(len(v) for v in matched.values()) / max(len(haystack.split()), 1)
    confidence = min(confidence, 1.0)
    return Classification(
        subjects=subjects, confidence=round(confidence, 3), matched_terms=matched
    )
