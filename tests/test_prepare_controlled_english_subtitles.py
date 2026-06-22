import sys
import tempfile
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from prepare_controlled_english_subtitles import load_srt


class LoadSrtTests(unittest.TestCase):
    def test_keeps_empty_canonical_cue_for_skipped_subtitle(self):
        content = (
            "\ufeff1\n"
            "00:00:00,000 --> 00:00:03,000\n"
            "\n"
            "\n"
            "2\n"
            "00:00:08,880 --> 00:00:10,640\n"
            "[候选 Speaker 1] 你说人是你杀的，\n"
        )
        with tempfile.TemporaryDirectory() as directory:
            subtitle_path = Path(directory) / "最终中文字幕.srt"
            subtitle_path.write_text(content, encoding="utf-8")

            cues = load_srt(subtitle_path)

        self.assertEqual([cue.number for cue in cues], [1, 2])
        self.assertEqual(cues[0].text, "")
        self.assertEqual(cues[1].text, "[候选 Speaker 1] 你说人是你杀的，")


if __name__ == "__main__":
    unittest.main()
