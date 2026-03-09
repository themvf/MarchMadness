"""Tests for team name mapping matrix."""

import pytest
from ingest.team_mappings import (
    TEAM_MAP,
    resolve_canonical_name,
    _BY_TORVIK,
    _BY_NCAA,
    _BY_ODDS,
)


class TestTeamMap:
    def test_has_all_power_conference_teams(self):
        """All major conference teams must be in the mapping."""
        power_teams = [
            "Duke", "North Carolina", "Kansas", "Kentucky", "Gonzaga",
            "Alabama", "Houston", "Purdue", "Connecticut", "Michigan State",
            "Arizona", "Baylor", "UCLA", "Tennessee", "Auburn",
            "Florida", "Texas", "Iowa State", "Marquette", "Creighton",
            "St. John's", "Oregon", "Illinois", "Wisconsin", "Indiana",
        ]
        for team in power_teams:
            assert resolve_canonical_name(team, "any") is not None, f"{team} not found"

    def test_no_duplicate_canonical_names(self):
        names = [t[0] for t in TEAM_MAP]
        assert len(names) == len(set(names)), "Duplicate canonical names found"

    def test_no_duplicate_torvik_names(self):
        torvik_names = [t[2] for t in TEAM_MAP if t[2]]
        assert len(torvik_names) == len(set(torvik_names)), "Duplicate Torvik names"

    def test_no_duplicate_ncaa_names(self):
        ncaa_names = [t[3] for t in TEAM_MAP if t[3]]
        assert len(ncaa_names) == len(set(ncaa_names)), "Duplicate NCAA names"


class TestResolveCanonicalName:
    @pytest.mark.parametrize("source_name,source,expected", [
        ("Connecticut", "torvik", "Connecticut"),
        ("UConn", "ncaa", "Connecticut"),
        ("Connecticut Huskies", "odds", "Connecticut"),
        ("N.C. State", "torvik", "North Carolina State"),
        ("NC State", "ncaa", "North Carolina State"),
        ("Duke Blue Devils", "odds", "Duke"),
        ("Michigan St.", "torvik", "Michigan State"),
        ("Appalachian St.", "torvik", "Appalachian State"),
        ("Saint Mary's Gaels", "odds", "Saint Mary's"),
    ])
    def test_cross_source_resolution(self, source_name, source, expected):
        assert resolve_canonical_name(source_name, source) == expected

    def test_any_source_fallback(self):
        assert resolve_canonical_name("Duke", "any") == "Duke"
        assert resolve_canonical_name("Michigan St.", "any") == "Michigan State"

    def test_unknown_team_returns_none(self):
        assert resolve_canonical_name("Fake University", "any") is None

    def test_case_insensitive(self):
        assert resolve_canonical_name("duke", "any") == "Duke"
        assert resolve_canonical_name("DUKE", "any") == "Duke"
        assert resolve_canonical_name("Duke Blue Devils", "odds") == "Duke"


class TestMappingCompleteness:
    def test_every_entry_has_five_fields(self):
        for entry in TEAM_MAP:
            assert len(entry) == 5, f"Entry has {len(entry)} fields: {entry}"

    def test_every_entry_has_canonical_and_conference(self):
        for entry in TEAM_MAP:
            assert entry[0], f"Empty canonical name: {entry}"
            assert entry[1], f"Empty conference: {entry}"

    def test_minimum_team_count(self):
        """D1 has ~360 teams; we should have most of them."""
        assert len(TEAM_MAP) >= 300
