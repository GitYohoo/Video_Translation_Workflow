import argparse
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from voxcpm_dubbing_workflow import select_segments_for_dubbing


class SelectSegmentsForDubbingTests(unittest.TestCase):
    def test_segment_number_selects_only_that_segment(self):
        segments = [
            SimpleNamespace(number=1),
            SimpleNamespace(number=2),
            SimpleNamespace(number=3),
        ]
        args = argparse.Namespace(start_number=1, max_segments=None, segment_number=2)

        selected = select_segments_for_dubbing(segments, args)

        self.assertEqual([segment.number for segment in selected], [2])

    def test_segment_number_missing_from_manifest_fails(self):
        segments = [SimpleNamespace(number=1), SimpleNamespace(number=3)]
        args = argparse.Namespace(start_number=1, max_segments=None, segment_number=2)

        with self.assertRaisesRegex(ValueError, "找不到编号 002"):
            select_segments_for_dubbing(segments, args)


if __name__ == "__main__":
    unittest.main()
