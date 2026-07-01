import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "merge_final_chinese_subtitles.py"
SPEC = importlib.util.spec_from_file_location("merge_final_chinese_subtitles", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class MergeFinalChineseSubtitlesTests(unittest.TestCase):
    def test_keeps_non_overlapping_ocr_and_speech_recognition_cues(self):
        ocr_cues = [
            {"start": 1.0, "end": 2.0, "text": "画面字幕"},
            {"start": 6.0, "end": 7.0, "text": "另一条画面字幕"},
        ]
        speaker_cues = [
            {"start": 3.0, "end": 4.0, "text": "Speaker A: 旁白", "speaker": "Speaker A"},
        ]

        merged = MODULE.attach_speakers(ocr_cues, speaker_cues)

        self.assertEqual(
            merged,
            [
                {"start": 1.0, "end": 2.0, "text": "画面字幕"},
                {"start": 3.0, "end": 4.0, "text": "旁白", "speaker": "Speaker A"},
                {"start": 6.0, "end": 7.0, "text": "另一条画面字幕"},
            ],
        )


if __name__ == "__main__":
    unittest.main()
