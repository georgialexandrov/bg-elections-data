#!/usr/bin/env python3
"""
migrate_schema.py

Final step in the import pipeline. Optimizes the schema for query
performance and disk usage, then rebuilds a cross-election summary view.

  1. votes: drop `id`, switch to WITHOUT ROWID with composite PK
       (election_id, section_code, party_number)
       The PK is the clustered index — separate section/election indexes dropped.

  2. preferences: same treatment
       PK: (election_id, section_code, party_number, candidate_number)

  3. section_scores: WITHOUT ROWID, composite PK replaces UNIQUE + separate indexes
       PK: (election_id, section_code)

  4. Create section_risk_history view — aggregates risk scores per polling
     station across all elections, joined with section_locations for address data.

  5. VACUUM

Estimated saving: ~400-500 MB
Safe to re-run: each migration drops its _old table at the start if it exists.
"""

import os
import sqlite3
import time
from pathlib import Path

DB_PATH = Path(os.environ.get("ELECTIONS_DB", Path(__file__).parent.parent / "elections.db"))


def step(msg: str) -> None:
    print(f"\n{'='*60}\n{msg}")


def run(conn: sqlite3.Connection, sql: str) -> None:
    t = time.time()
    conn.executescript(sql)
    print(f"  done in {time.time()-t:.1f}s")


def migrate_votes(conn: sqlite3.Connection) -> None:
    step("votes: drop id, WITHOUT ROWID + compound PK")
    run(conn, """
        DROP TABLE IF EXISTS votes_old;

        ALTER TABLE votes RENAME TO votes_old;

        CREATE TABLE votes (
            election_id  INTEGER NOT NULL,
            section_code TEXT    NOT NULL,
            party_number INTEGER NOT NULL,
            total        INTEGER DEFAULT 0,
            paper        INTEGER DEFAULT 0,
            machine      INTEGER DEFAULT 0,
            PRIMARY KEY (election_id, section_code, party_number),
            FOREIGN KEY (election_id) REFERENCES elections(id)
        ) WITHOUT ROWID;

        INSERT OR IGNORE INTO votes
        SELECT election_id, section_code, party_number, total, paper, machine
        FROM votes_old;

        DROP TABLE votes_old;
    """)
    run(conn, """
        CREATE INDEX idx_votes_section_election ON votes(section_code, election_id);
        CREATE INDEX idx_votes_election ON votes(election_id);
    """)


def migrate_preferences(conn: sqlite3.Connection) -> None:
    step("preferences: drop id, WITHOUT ROWID + compound PK")
    run(conn, """
        DROP TABLE IF EXISTS preferences_old;

        ALTER TABLE preferences RENAME TO preferences_old;

        CREATE TABLE preferences (
            election_id      INTEGER NOT NULL,
            section_code     TEXT    NOT NULL,
            party_number     INTEGER NOT NULL,
            candidate_number TEXT    NOT NULL,
            total            INTEGER DEFAULT 0,
            paper            INTEGER DEFAULT 0,
            machine          INTEGER DEFAULT 0,
            PRIMARY KEY (election_id, section_code, party_number, candidate_number),
            FOREIGN KEY (election_id) REFERENCES elections(id)
        ) WITHOUT ROWID;

        INSERT OR IGNORE INTO preferences
        SELECT election_id, section_code, party_number, candidate_number,
               total, paper, machine
        FROM preferences_old;

        DROP TABLE preferences_old;
    """)
    run(conn, """
        CREATE INDEX idx_pref_section_election ON preferences(section_code, election_id);
    """)


def migrate_section_scores(conn: sqlite3.Connection) -> None:
    step("section_scores: WITHOUT ROWID + composite PK, drop redundant indexes")
    run(conn, """
        DROP TABLE IF EXISTS section_scores_old;

        ALTER TABLE section_scores RENAME TO section_scores_old;

        CREATE TABLE section_scores (
            election_id             INTEGER NOT NULL,
            section_code            TEXT    NOT NULL,
            arithmetic_error        INTEGER DEFAULT 0,
            vote_sum_mismatch       INTEGER DEFAULT 0,
            turnout_rate            REAL,
            turnout_zscore          REAL,
            turnout_zscore_norm     REAL,
            benford_chi2            REAL,
            benford_p               REAL,
            benford_score           REAL,
            ekatte_turnout_zscore       REAL,
            ekatte_turnout_zscore_norm  REAL,
            peer_vote_deviation         REAL,
            peer_vote_deviation_norm    REAL,
            risk_score              REAL,
            PRIMARY KEY (election_id, section_code),
            FOREIGN KEY (election_id) REFERENCES elections(id)
        ) WITHOUT ROWID;

        INSERT OR IGNORE INTO section_scores
        SELECT election_id, section_code,
               arithmetic_error, vote_sum_mismatch,
               turnout_rate, turnout_zscore, turnout_zscore_norm,
               benford_chi2, benford_p, benford_score,
               ekatte_turnout_zscore, ekatte_turnout_zscore_norm,
               peer_vote_deviation, peer_vote_deviation_norm,
               risk_score
        FROM section_scores_old;

        DROP TABLE section_scores_old;

        CREATE INDEX idx_scores_risk ON section_scores(risk_score DESC);
        CREATE INDEX idx_section_scores_election ON section_scores(election_id);
    """)


def create_view(conn: sqlite3.Connection) -> None:
    step("section_risk_history view — risk score aggregates per polling station across all elections")
    run(conn, """
        DROP VIEW IF EXISTS section_risk_history;

        CREATE VIEW section_risk_history AS
        SELECT
            sc.section_code,
            sl.settlement_name,
            sl.address,
            sl.ekatte,
            COUNT(*)                                    AS elections_scored,
            ROUND(AVG(sc.risk_score), 4)                AS avg_risk_score,
            ROUND(MAX(sc.risk_score), 4)                AS max_risk_score,
            SUM(sc.arithmetic_error)                    AS total_arithmetic_errors,
            SUM(sc.vote_sum_mismatch)                   AS total_vote_mismatches,
            ROUND(AVG(sc.ekatte_turnout_zscore_norm),4) AS avg_ekatte_turnout_anomaly,
            ROUND(AVG(sc.peer_vote_deviation_norm), 4)  AS avg_peer_vote_anomaly,
            ROUND(
                AVG(CASE WHEN sc.election_id <= 3 THEN sc.risk_score END) -
                AVG(CASE WHEN sc.election_id > 3  THEN sc.risk_score END),
                4
            )                                           AS risk_trend
        FROM section_scores sc
        LEFT JOIN sections s ON s.section_code = sc.section_code
        LEFT JOIN locations sl ON sl.id = s.location_id
        GROUP BY sc.section_code;
    """)


def vacuum(conn: sqlite3.Connection) -> None:
    step("VACUUM")
    t = time.time()
    conn.execute("VACUUM")
    print(f"  done in {time.time()-t:.1f}s")


def print_sizes() -> None:
    step("DB size after migration")
    size = os.path.getsize(DB_PATH)
    if size >= 1024 ** 3:
        print(f"  {size / 1024**3:.2f} GB  {DB_PATH.name}")
    else:
        print(f"  {size / 1024**2:.1f} MB  {DB_PATH.name}")


def main() -> None:
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")

    # Drop the view first — SQLite validates views on every table rename
    conn.executescript("DROP VIEW IF EXISTS section_risk_history;")

    migrate_votes(conn)
    migrate_preferences(conn)

    # section_scores + view only if score_sections.py was run
    has_scores = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='section_scores'"
    ).fetchone()
    if has_scores:
        migrate_section_scores(conn)
        create_view(conn)

    vacuum(conn)
    conn.close()
    print_sizes()


if __name__ == "__main__":
    main()
