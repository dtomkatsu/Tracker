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
        # Target the transit agencies specifically rather than bare
        # "transportation": the latter rides along in the Maui ADEPT committee
        # name ("...and Public Transportation") on dozens of unrelated ag/
        # environment items. These catch HART and the Dept. of Transportation
        # Services without that contamination.
        r"\brapid transportation\b",
        r"\btransportation services\b",
        r"\bsidewalk\b",
        r"\bintersection\b",
        r"\broundabout\b",
        r"\bmoped\b",
        r"\bscooter\b",
        r"\bshuttle\b",
        r"\bparatransit\b",
        r"\bmultimodal\b",
        r"\bmobility\b",
        r"\bright[- ]of[- ]way\b",
        r"\bvision zero\b",
        r"\bharbor\b",
        r"\bairport\b",
        r"\bfreight\b",
        r"\belectric vehicle\b",
        r"\b(EV|vehicle) charging\b",
        r"\btraffic calming\b",
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
        # "meals" is mostly school/kupuna meal programs once the gift-disclosure
        # veto removes "gift of ... meals" ethics resolutions. ("garden" is left
        # to the existing "community garden" — bare it matches botanical gardens;
        # "ranch" matches Hawaii place names, so livestock covers that instead.)
        r"\bmeals?\b",
        r"\bschool (lunch|meal|breakfast)\b",
        r"\blivestock\b",
        r"\bpoultry\b",
        r"\bdairy\b",
        r"\btaro\b",
        r"\bkalo\b",
        r"\bcrop(s|land)?\b",
        r"\bfood (system|security|access)\b",
        r"\bfarmers?[' ]?\s*market\b",
        r"\bcommunity kitchen\b",
        r"\bfeeding\b",
    ],
    "affordable_housing": [
        r"\baffordable housing\b",
        r"\bhousing\b",
        r"\bADU\b",
        r"\baccessory dwelling\b",
        r"\bdwelling\b",
        r"\bohana\b",
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
        # Land-use / planning language that carries housing & development bills
        # whose titles never say "housing" outright (the common miss).
        r"\bland use\b",
        r"\bsubdivision\b",
        r"\bgeneral plan\b",
        r"\bresidential\b",
        r"\bapartment\b",
        r"\bsingle[- ]family\b",
        r"\bmulti[- ]?family\b",
        r"\bduplex\b",
        r"\bcondominium\b",
        r"\bplanned unit development\b",
        r"\binfill\b",
        r"\btenant(s)?\b",
        r"\blandlord(s)?\b",
        r"\beviction(s)?\b",
    ],
}

_COMPILED: dict[str, list[re.Pattern]] = {
    subject: [re.compile(p, re.IGNORECASE) for p in patterns]
    for subject, patterns in _RULES.items()
}

# Special Management Area (coastal) major permits routinely read "construction
# of a single-family dwelling" but are one-off, individual development permits —
# not housing policy. Don't let those generic terms alone file them under
# affordable_housing; a stronger housing term still can.
_SMA_RE = re.compile(r"special management area|\bSMA\b", re.IGNORECASE)
_HOUSING_WEAK = {"dwelling", "single-family", "single family"}

# "ACCEPTING A GIFT OF ..." resolutions are HRS gift disclosures (travel, meals,
# transportation given to councilmembers) — administrative, not policy. Their
# contents would otherwise mis-tag them (gift of meals -> food, gift of
# transportation -> transit), so they're left entirely unclassified.
_GIFT_RE = re.compile(r"\baccepting a gift\b", re.IGNORECASE)


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

    # Gift-disclosure resolutions carry no policy subject — skip entirely.
    if _GIFT_RE.search(haystack):
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

    # Veto housing on coastal individual-permit (SMA) bills matched only on the
    # weak "dwelling / single-family" terms.
    if "affordable_housing" in matched and _SMA_RE.search(haystack):
        strong = [t for t in matched["affordable_housing"] if t.lower() not in _HOUSING_WEAK]
        if not strong:
            del matched["affordable_housing"]

    subjects = [s for s in SUBJECTS if s in matched]
    confidence = sum(len(v) for v in matched.values()) / max(len(haystack.split()), 1)
    confidence = min(confidence, 1.0)
    return Classification(
        subjects=subjects, confidence=round(confidence, 3), matched_terms=matched
    )
