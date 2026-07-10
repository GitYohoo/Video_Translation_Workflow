import importlib.util
import sys
import types
import unittest
from pathlib import Path


sys.modules.setdefault("cv2", types.ModuleType("cv2"))
paddleocr = types.ModuleType("paddleocr")
paddleocr.PaddleOCR = object
sys.modules.setdefault("paddleocr", paddleocr)

SCRIPT_PATH = Path(__file__).parents[1] / "scripts" / "burned_subtitle_ocr.py"
SPEC = importlib.util.spec_from_file_location("burned_subtitle_ocr", SCRIPT_PATH)
ocr_script = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(ocr_script)


class OcrProfileTests(unittest.TestCase):
    def test_uses_pp_ocr_v6_for_default_profiles_and_keeps_v5_fallbacks(self):
        self.assertEqual(
            ocr_script.OCR_PROFILES["quality"],
            ("PP-OCRv6_medium_det", "PP-OCRv6_medium_rec"),
        )
        self.assertEqual(
            ocr_script.OCR_PROFILES["fast"],
            ("PP-OCRv6_small_det", "PP-OCRv6_small_rec"),
        )
        self.assertEqual(
            ocr_script.OCR_PROFILES["quality-v5"],
            ("PP-OCRv5_server_det", "PP-OCRv5_server_rec"),
        )


class PostprocessCuesTests(unittest.TestCase):
    def test_merges_one_character_ocr_variants_in_short_subtitle(self):
        cues = [
            {"start": 203.04, "end": 203.28, "text": "你想多子", "confidence": 0.9163},
            {"start": 203.28, "end": 203.88, "text": "你想多了", "confidence": 0.9361},
            {"start": 203.88, "end": 204.24, "text": "你想多子", "confidence": 0.9163},
        ]

        result = ocr_script.postprocess_cues(cues, {})

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["text"], "你想多了")
        self.assertEqual((result[0]["start"], result[0]["end"]), (203.04, 204.24))

    def test_merges_simplified_and_traditional_one_character_variant(self):
        cues = [
            {"start": 237.76, "end": 238.52, "text": "没人注意他", "confidence": 0.873},
            {"start": 238.52, "end": 238.64, "text": "没人註意他", "confidence": 0.9123},
        ]

        result = ocr_script.postprocess_cues(cues, {})

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["text"], "没人注意他")
        self.assertEqual((result[0]["start"], result[0]["end"]), (237.76, 238.64))


if __name__ == "__main__":
    unittest.main()
