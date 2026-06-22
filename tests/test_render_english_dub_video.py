import tempfile
import unittest
from pathlib import Path

from scripts.render_english_dub_video import SubtitleCue, write_ass


class RenderEnglishDubVideoTests(unittest.TestCase):
    def test_ass_uses_normalized_position_for_every_subtitle(self):
        cue = SubtitleCue(1, 0, 1500, "Move me")
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "positioned.ass"
            write_ass(
                output,
                [cue],
                "Segoe UI Semibold",
                50,
                "#FFFFFF",
                "#101010",
                1.0,
                37.5,
                62.5,
            )
            content = output.read_text(encoding="utf-8-sig")

        self.assertIn(r"{\an5\pos(720,675)}Move me", content)


if __name__ == "__main__":
    unittest.main()
