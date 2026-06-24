import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "final_validation.py"
SPEC = importlib.util.spec_from_file_location("final_validation", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class FinalValidationFilterTests(unittest.TestCase):
    def test_mutes_background_and_replaces_selected_ranges_with_source_audio(self):
        filter_graph, audio_label = MODULE.build_filter_complex(
            source_audio_ranges=[{"start": 2.0, "end": 4.0}],
            muted_background_ranges=[{"start": 8.0, "end": 9.5}],
        )

        self.assertIn("volume=0:enable='between(t,8.000000,9.500000)'", filter_graph)
        self.assertIn("volume=0:enable='between(t,2.000000,4.000000)'", filter_graph)
        self.assertIn("volume=0:enable='not(between(t,2.000000,4.000000))'", filter_graph)
        self.assertEqual(audio_label, "[verified]")

    def test_uses_dialogue_and_background_only_without_source_ranges(self):
        filter_graph, audio_label = MODULE.build_filter_complex(
            source_audio_ranges=[],
            muted_background_ranges=[],
        )

        self.assertIn("[dialogue][background]amix=inputs=2", filter_graph)
        self.assertNotIn("[3:a:0]", filter_graph)
        self.assertEqual(audio_label, "[base]")


if __name__ == "__main__":
    unittest.main()
