"""
Parses a Rapsodo CSV export into structured Shot records.

CSV formats encountered:
  Practice:     Row 1 = headers, Row 2+ = shots
  Combine/Range: Row 1 = metadata, Row 2 = blank, Row 3 = headers, Row 4+ = shots
  Target Range:  Session metadata, then N sections each containing:
                   "{distance} Yds", "accuracy" row
                   Column headers row
                   Shot data rows
                   "Average" summary row  (skip)
                   "Std. Dev." summary row  (skip)
                   Blank separator row
"""

from __future__ import annotations

import csv
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path
from typing import Any

COLUMN_MAP: dict[str, str] = {
    "club type":          "club_type",
    "club brand":         "club_brand",
    "club model":         "club_model",
    "carry distance":     "carry_distance",
    "total distance":     "total_distance",
    "ball speed":         "ball_speed",
    "launch angle":       "launch_angle",
    "launch direction":   "launch_direction",
    "apex":               "apex",
    "side carry":         "side_carry",
    "club speed":         "club_speed",
    "smash factor":       "smash_factor",
    "descent angle":      "descent_angle",
    "attack angle":       "attack_angle",
    "club path":          "club_path",
    "spin rate":          "spin_rate",
    "spin axis":          "spin_axis",
}

FLOAT_FIELDS = {
    "ball_speed", "launch_angle", "launch_direction", "spin_rate", "spin_axis",
    "smash_factor", "carry_distance", "total_distance", "side_carry",
    "apex", "descent_angle", "club_speed", "attack_angle", "club_path",
}

# Row values in the first column that indicate a computed summary row, not a shot
SKIP_CLUB_TYPES = {"average", "std. dev.", "std.dev.", "club type"}


@dataclass
class Shot:
    session_id: str
    shot_number: int
    club: str | None = None
    club_type: str | None = None
    target_distance: float | None = None
    is_outlier: bool = False
    outlier_note: str | None = None
    ball_speed: float | None = None
    launch_angle: float | None = None
    launch_direction: float | None = None
    spin_rate: float | None = None
    spin_axis: float | None = None
    smash_factor: float | None = None
    carry_distance: float | None = None
    total_distance: float | None = None
    side_carry: float | None = None
    apex: float | None = None
    descent_angle: float | None = None
    club_speed: float | None = None
    attack_angle: float | None = None
    club_path: float | None = None

    @property
    def shot_id(self) -> str:
        return f"{self.session_id}:{self.shot_number}"


@dataclass
class ParsedSession:
    session_id: str
    session_date: datetime
    session_type: str
    shots: list[Shot] = field(default_factory=list)
    scraped_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


def parse_csv(
    csv_path: Path,
    session_id: str,
    session_date: str,
    session_type: str,
) -> ParsedSession:
    raw_lines = csv_path.read_text(encoding="utf-8-sig").splitlines()

    # Extract session date from first metadata line if present
    csv_date = _extract_metadata_date(raw_lines[0]) if raw_lines else None
    parsed_date = csv_date or _parse_date(session_date)

    session = ParsedSession(
        session_id=session_id,
        session_date=parsed_date,
        session_type=session_type,
    )

    # Parse each section of the CSV (handles single-section and multi-section formats)
    shot_counter = 0
    for section_lines, target_distance in _split_sections(raw_lines):
        reader = csv.DictReader(StringIO("\n".join(section_lines)))
        for raw_row in reader:
            shot_counter += 1
            shot = _parse_row(raw_row, session_id, shot_counter, target_distance)
            if shot is not None:
                session.shots.append(shot)

    return session


def _split_sections(lines: list[str]) -> list[tuple[list[str], float | None]]:
    """
    Split the CSV into sections, each containing one column-header row + shot rows.
    Returns a list of (section_lines, target_distance_yards).
    """
    # Find all indices where "Club Type" appears (column header rows)
    header_indices = [i for i, line in enumerate(lines) if "Club Type" in line]
    if not header_indices:
        return []

    sections = []
    for j, h_idx in enumerate(header_indices):
        # Section ends just before the next header (or end of file)
        end_idx = header_indices[j + 1] if j + 1 < len(header_indices) else len(lines)
        section_lines = lines[h_idx:end_idx]

        # Look for a target distance in the line immediately before this header
        target_distance = None
        if h_idx > 0:
            prev_line = lines[h_idx - 1]
            target_distance = _extract_target_distance(prev_line)

        sections.append((section_lines, target_distance))

    return sections


def _extract_target_distance(line: str) -> float | None:
    """Extract yards value from lines like '"207 Yds","1/2 (50%)",...'"""
    match = re.search(r'"?(\d+(?:\.\d+)?)\s*Yds"?', line, re.IGNORECASE)
    if match:
        try:
            return float(match.group(1))
        except ValueError:
            pass
    return None


def _parse_row(
    raw: dict[str, str | None],
    session_id: str,
    shot_number: int,
    target_distance: float | None,
) -> Shot | None:
    mapped: dict[str, Any] = {}
    for raw_key, value in raw.items():
        if raw_key is None:
            continue
        schema_key = COLUMN_MAP.get(raw_key.strip().lower())
        if schema_key and value is not None:
            mapped[schema_key] = value.strip()

    # Skip summary rows (Average, Std. Dev.), header repeats, target info rows, and blank rows
    club_type_raw = mapped.get("club_type", "")
    if not club_type_raw or club_type_raw.lower() in SKIP_CLUB_TYPES:
        return None
    if re.search(r"\d+\s*Yds", club_type_raw, re.IGNORECASE):  # target distance row
        return None
    if not any(mapped.values()):
        return None

    shot = Shot(session_id=session_id, shot_number=shot_number)
    shot.target_distance = target_distance

    brand = mapped.get("club_brand", "")
    model = mapped.get("club_model", "")
    shot.club = f"{brand} {model}".strip() or None
    shot.club_type = club_type_raw or None

    for f in FLOAT_FIELDS:
        raw_val = mapped.get(f)
        if raw_val not in (None, "", "--", "N/A"):
            try:
                setattr(shot, f, float(raw_val))
            except ValueError:
                pass

    return shot


def _extract_metadata_date(first_line: str) -> datetime | None:
    match = re.search(r"(\d{1,2}/\d{1,2}/\d{4})\s+(\d{1,2}:\d{2}\s*[APap][Mm])", first_line)
    if not match:
        return None
    try:
        return datetime.strptime(
            f"{match.group(1)} {match.group(2).upper().replace(' ', '')}",
            "%m/%d/%Y %I:%M%p",
        ).replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _parse_date(date_str: str) -> datetime:
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%m/%d/%Y", "%m/%d/%y", "%Y-%m-%d"):
        try:
            return datetime.strptime(date_str, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return datetime.now(timezone.utc)
