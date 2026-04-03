#!/usr/bin/env python3
"""
normalize_parties.py

Deduplicates parties across elections into a canonical parties table,
with an election_parties junction table for per-election ballot entries.

Before:
  parties(id, election_id, number, name, rik_code)
  → ~1800 rows, same party repeated per election

After:
  parties(id, canonical_name, short_name, party_type)
  → ~200-300 unique political entities

  election_parties(election_id, ballot_number, party_id, name_on_ballot)
  → ~1800 rows, one per ballot entry per election

Matching strategy:
  1. Normalize names (strip ПП/КП prefix, quotes, whitespace)
  2. Exact match on normalized name → same party
  3. Manual overrides from party_overrides.json for tricky cases

votes.party_number is the ballot number — unchanged, joins through election_parties.
"""

import json
import os
import re
import sqlite3
from pathlib import Path

DB_PATH = Path(os.environ.get("ELECTIONS_DB", Path(__file__).parent.parent / "elections.db"))
OVERRIDES_PATH = Path(__file__).parent / "party_overrides.json"
# party-metadata.json with namesBG variants, colors, wiki URLs
# Check both local data/ dir and parent results/ dir
METADATA_PATH = Path(__file__).parent / "party-metadata.json"
if not METADATA_PATH.exists():
    METADATA_PATH = Path(__file__).parent.parent / "results" / "party-metadata.json"
COALITION_MEMBERS_PATH = Path(__file__).parent / "coalition_members.json"

# Fallback colors from Wikipedia Module:Political_party
# Applied when party-metadata.json doesn't have a color for the canonical name
COLOR_OVERRIDES: dict[str, str] = {
    # Major parties missing from metadata
    "АТАКА":           "#344D28",
    "БСП за България":  "#DB0F28",
    "БСП":             "#D61920",
    "ГЕРБ":            "#0054A6",
    "СДС":             "#0A459F",
    "ВМРО":            "#E63A30",
    "ВОЛЯ":            "#00718F",
    "НФСБ":            "#1C4482",
    "ДСБ":             "#02528A",
    "Зелено движение": "#009966",
    "Да, България!":   "#50AF50",
    "Отровното трио":  "#4C813D",
    # Coalitions / rebrandings
    "ДЕМОКРАТИЧНА БЪЛГАРИЯ - ОБЕДИНЕНИЕ (ДА България, ДСБ, Зелено движение)": "#004A80",
    "Изправи се! Мутри вън!":       "#4C813D",
    "Изправи се.БГ":                "#5BA546",
    "ИЗПРАВИ СЕ БГ! НИЕ ИДВАМЕ!":  "#50BE5B",
    "ПАТРИОТИЧНА КОАЛИЦИЯ - ВОЛЯ И НФСБ":  "#01193B",
    "ПАТРИОТИЧЕН ФРОНТ - НФСБ, БДС РАДИКАЛИ И БНДС ЦЕЛОКУПНА БЪЛГАРИЯ": "#1C4482",
    "ГЛАС НАРОДЕН":    "#808080",
}


def normalize_name(name: str) -> str:
    """Normalize party name for dedup matching.

    Strips prefixes (ПП, КП, Партия, Коалиция), quotes, extra whitespace.
    Normalizes dash variants and spacing around dashes.
    """
    s = name.strip()
    # Remove surrounding quotes
    s = re.sub(r'^["""\'„\u201c\u201d\u201e]+|["""\'„\u201c\u201d\u201e]+$', '', s).strip()
    # Remove all internal quotes too
    s = re.sub(r'["""\'„\u201c\u201d\u201e]', '', s)
    # Strip common prefixes
    s = re.sub(r'^(ПП|КП|Партия|Коалиция)\s+', '', s, flags=re.IGNORECASE).strip()
    # Normalize dashes (en-dash, em-dash → hyphen-minus)
    s = re.sub(r'[\u2013\u2014\u2012]', '-', s)
    # Normalize spacing around dashes: "X - Y", "X -Y", "X- Y" → "X - Y"
    # But keep "X-Y" (no spaces) as-is for compound names like "ГЕРБ-СДС"
    s = re.sub(r'\s*-\s+', ' - ', s)
    s = re.sub(r'\s+-\s*', ' - ', s)
    # Collapse whitespace
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def short_name(canonical: str) -> str:
    """Generate a short display name from canonical name."""
    # If it has a dash with spaces, take the first part for very long names
    # But keep short coalition names as-is (e.g. "ГЕРБ-СДС")
    if len(canonical) > 40 and ' - ' in canonical:
        return canonical.split(' - ')[0].strip()
    return canonical


def classify_party(name: str) -> str:
    """Classify party type from name patterns."""
    lower = name.lower()
    coalition_markers = ['коалиция', 'коал.', 'предизб.съюз', 'обединени патриоти',
                         'демократична левица', 'обединени демократични сили']
    if any(m in lower for m in coalition_markers):
        return 'coalition'
    ic_markers = ['инициативен комитет', 'ик ']
    if any(m in lower for m in ic_markers):
        return 'initiative_committee'
    return 'party'


def load_overrides() -> dict[str, str]:
    """Load manual name → canonical_name overrides.

    Format: {"exact name from CIK": "canonical name to map to", ...}
    """
    if not OVERRIDES_PATH.exists():
        return {}
    with open(OVERRIDES_PATH) as f:
        return json.load(f)


def load_metadata() -> tuple[dict[str, str], dict[str, dict]]:
    """Load party-metadata.json.

    Returns:
      - name_to_canonical: normalized variant → canonical name
      - party_meta: canonical name → {color, wiki_url, party_type}
    """
    name_to_canonical: dict[str, str] = {}
    party_meta: dict[str, dict] = {}

    if not METADATA_PATH.exists():
        print(f"  party-metadata.json not found at {METADATA_PATH}, skipping metadata")
        return name_to_canonical, party_meta

    with open(METADATA_PATH) as f:
        data = json.load(f)

    count = 0
    for tier_key, tier_parties in data.items():
        if tier_key.startswith("_") or not isinstance(tier_parties, list):
            continue
        for entry in tier_parties:
            names_bg = entry.get("namesBG", [])
            if not names_bg:
                continue
            canonical = names_bg[0]
            color = entry.get("wikiColor")
            wiki = entry.get("wikipediaBG") or entry.get("wikipediaEN")

            party_meta[canonical] = {
                "color": color,
                "wiki_url": wiki,
                "party_type": "coalition" if any(
                    m in canonical.lower() for m in ["коалиция", "обединени"]
                ) else "party",
            }

            # Map all name variants (both original and normalized) to canonical
            for name in names_bg:
                norm = normalize_name(name)
                name_to_canonical[norm] = canonical
                # Also map the original name directly (for exact override)
                name_to_canonical[name] = canonical
            count += 1

    print(f"  Loaded {count} parties from party-metadata.json ({len(name_to_canonical)} name variants)")
    return name_to_canonical, party_meta


def main() -> None:
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    overrides = load_overrides()
    meta_names, party_meta = load_metadata()

    # Load all current party entries
    old_parties = cur.execute(
        "SELECT id, election_id, number, name, rik_code FROM parties ORDER BY election_id, number"
    ).fetchall()
    print(f"Old parties table: {len(old_parties):,} rows")

    # Step 1: Build canonical party mapping
    # Priority: manual overrides > metadata namesBG > normalize_name dedup
    canonical_map: dict[str, str] = {}
    canonical_ids: dict[str, int] = {}
    ep_rows: list[tuple] = []

    # Pre-seed canonical_map from metadata
    for norm, canon in meta_names.items():
        n = normalize_name(norm)
        canonical_map[n] = canon
    print(f"  Pre-seeded {len(canonical_map)} normalized names from metadata")

    next_id = 1

    seen_ep: set[tuple] = set()
    for old_id, election_id, number, name, rik_code in old_parties:
        if not name or name.isdigit():
            continue
        if (election_id, number) in seen_ep:
            continue
        seen_ep.add((election_id, number))

        # Priority 1: manual overrides (exact match)
        if name in overrides:
            canon = overrides[name]
        else:
            norm = normalize_name(name)
            # Priority 2: metadata name variants
            # Priority 3: previously seen normalized name
            if norm in canonical_map:
                canon = canonical_map[norm]
            else:
                canon = norm
                canonical_map[norm] = canon

        if canon not in canonical_ids:
            canonical_ids[canon] = next_id
            next_id += 1

        party_id = canonical_ids[canon]
        ep_rows.append((election_id, number, party_id, name))

    print(f"Canonical parties: {len(canonical_ids):,}")
    print(f"Election-party entries: {len(ep_rows):,}")

    # Step 2: Build party rows with metadata (color, wiki)
    party_rows = []
    meta_matched = 0
    for canon, pid in sorted(canonical_ids.items(), key=lambda x: x[1]):
        meta = party_meta.get(canon, {})
        if meta:
            meta_matched += 1
        ptype = meta.get("party_type") or classify_party(canon)
        sname = short_name(canon)
        color = meta.get("color") or COLOR_OVERRIDES.get(canon)
        wiki = meta.get("wiki_url")
        party_rows.append((pid, canon, sname, ptype, color, wiki))

    print(f"  {meta_matched} parties matched to metadata (with color/wiki)")

    # Step 3: Write to DB
    cur.executescript("""
        DROP TABLE IF EXISTS election_parties;
        DROP TABLE IF EXISTS parties_new;
        DROP TABLE IF EXISTS parties_old;
    """)

    cur.executescript("""
        CREATE TABLE parties_new (
            id              INTEGER PRIMARY KEY,
            canonical_name  TEXT NOT NULL,
            short_name      TEXT,
            party_type      TEXT DEFAULT 'party',
            color           TEXT,
            wiki_url        TEXT
        );

        CREATE TABLE election_parties (
            election_id     INTEGER NOT NULL,
            ballot_number   INTEGER NOT NULL,
            party_id        INTEGER NOT NULL REFERENCES parties_new(id),
            name_on_ballot  TEXT,
            PRIMARY KEY (election_id, ballot_number),
            FOREIGN KEY (election_id) REFERENCES elections(id)
        );
    """)

    cur.executemany(
        "INSERT INTO parties_new (id, canonical_name, short_name, party_type, color, wiki_url) "
        "VALUES (?,?,?,?,?,?)",
        party_rows,
    )

    cur.executemany(
        "INSERT INTO election_parties (election_id, ballot_number, party_id, name_on_ballot) VALUES (?,?,?,?)",
        ep_rows,
    )

    # Atomic swap
    cur.executescript("""
        DROP TABLE parties;
        ALTER TABLE parties_new RENAME TO parties;
    """)
    cur.execute("CREATE INDEX idx_ep_election ON election_parties(election_id)")
    cur.execute("CREATE INDEX idx_ep_party ON election_parties(party_id)")
    conn.commit()

    # Stats
    n_parties = cur.execute("SELECT COUNT(*) FROM parties").fetchone()[0]
    n_ep = cur.execute("SELECT COUNT(*) FROM election_parties").fetchone()[0]
    n_coalition = cur.execute("SELECT COUNT(*) FROM parties WHERE party_type = 'coalition'").fetchone()[0]
    n_with_color = cur.execute("SELECT COUNT(*) FROM parties WHERE color IS NOT NULL").fetchone()[0]

    print(f"\nResult:")
    print(f"  parties:          {n_parties:,} ({n_coalition} coalitions, {n_with_color} with color)")
    print(f"  election_parties: {n_ep:,}")

    # Step 4: Import coalition members
    if COALITION_MEMBERS_PATH.exists():
        with open(COALITION_MEMBERS_PATH) as f:
            coalitions = json.load(f)

        # Build name → id lookup
        name_to_id = {row[0]: row[1] for row in cur.execute(
            "SELECT canonical_name, id FROM parties"
        ).fetchall()}

        cur.executescript("""
            DROP TABLE IF EXISTS coalition_members;
            CREATE TABLE coalition_members (
                coalition_id    INTEGER NOT NULL REFERENCES parties(id),
                member_party_id INTEGER NOT NULL REFERENCES parties(id),
                PRIMARY KEY (coalition_id, member_party_id)
            );
        """)

        # Auto-create member parties that never appeared on a ballot
        # (e.g. ГЕРБ, СДС, Да България!, ДСБ — always ran inside coalitions)
        next_party_id = cur.execute("SELECT MAX(id) FROM parties").fetchone()[0] + 1
        auto_created = []
        all_members = set()
        for members in coalitions.values():
            if isinstance(members, list):
                all_members.update(members)
        for member_name in sorted(all_members):
            if member_name.startswith("_"):
                continue
            if member_name not in name_to_id:
                meta = party_meta.get(member_name, {})
                ptype = meta.get("party_type") or "party"
                color = meta.get("color") or COLOR_OVERRIDES.get(member_name)
                wiki = meta.get("wiki_url")
                cur.execute(
                    "INSERT INTO parties (id, canonical_name, short_name, party_type, color, wiki_url) "
                    "VALUES (?,?,?,?,?,?)",
                    (next_party_id, member_name, member_name, ptype, color, wiki),
                )
                name_to_id[member_name] = next_party_id
                auto_created.append(member_name)
                next_party_id += 1
        if auto_created:
            conn.commit()
            print(f"\n  Auto-created {len(auto_created)} member-only parties: {', '.join(auto_created)}")

        cm_rows = []
        cm_missing = []
        for coalition_name, members in coalitions.items():
            if coalition_name.startswith("_"):
                continue
            coalition_id = name_to_id.get(coalition_name)
            if not coalition_id:
                cm_missing.append(f"coalition not found: {coalition_name}")
                continue
            for member_name in members:
                member_id = name_to_id.get(member_name)
                if not member_id:
                    cm_missing.append(f"member not found: {member_name} (in {coalition_name})")
                    continue
                cm_rows.append((coalition_id, member_id))

        cur.executemany(
            "INSERT INTO coalition_members (coalition_id, member_party_id) VALUES (?,?)",
            cm_rows,
        )
        conn.commit()

        print(f"\n  Coalition members: {len(cm_rows)} links")
        if cm_missing:
            print(f"  Missing references ({len(cm_missing)}):")
            for m in cm_missing:
                print(f"    {m}")

    # Show top parties by election appearances
    print(f"\nTop parties by election appearances:")
    for name, color, count in cur.execute("""
        SELECT p.canonical_name, p.color, COUNT(DISTINCT ep.election_id) as elections
        FROM election_parties ep
        JOIN parties p ON p.id = ep.party_id
        GROUP BY p.id
        ORDER BY elections DESC
        LIMIT 20
    """).fetchall():
        c = f" {color}" if color else ""
        print(f"  {count:>2}x  {name}{c}")

    conn.close()
    print("\nDone.")


if __name__ == "__main__":
    main()
