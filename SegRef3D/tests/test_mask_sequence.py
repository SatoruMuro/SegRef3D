import unittest

from mask_sequence import canonical_mask_records, export_mapping_preview


class MaskSequenceContractTests(unittest.TestCase):
    def test_512_slice_display_numbers_map_directly_to_png_numbers(self):
        records = canonical_mask_records(f"{index + 1:04d}" for index in range(512))
        self.assertEqual(records[0]["filename"], "mask0001.png")
        self.assertEqual(records[49]["filename"], "mask0050.png")
        self.assertEqual(records[99]["filename"], "mask0100.png")
        self.assertEqual(records[399]["filename"], "mask0400.png")
        self.assertEqual(records[511]["filename"], "mask0512.png")
        self.assertEqual(export_mapping_preview(records)[-1], "volume z=511 -> mask0512.png")


if __name__ == "__main__":
    unittest.main()
