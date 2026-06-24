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

    def test_ass_can_use_source_video_resolution_for_preview_matching(self):
        cue = SubtitleCue(1, 0, 1500, "Match preview size")
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "source-resolution.ass"
            write_ass(
                output,
                [cue],
                "Segoe UI Semibold",
                44,
                "#FFFFFF",
                "#101010",
                1.0,
                50.0,
                73.0,
                play_res_width=720,
                play_res_height=1280,
            )
            content = output.read_text(encoding="utf-8-sig")

        self.assertIn("PlayResX: 720", content)
        self.assertIn("PlayResY: 1280", content)
        self.assertIn("Style: EnglishAboveChinese,Segoe UI Semibold,44,", content)
        self.assertIn(r"{\an5\pos(360,934)}Match preview size", content)


if __name__ == "__main__":
    unittest.main()
