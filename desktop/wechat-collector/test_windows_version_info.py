import tempfile
import unittest
from pathlib import Path

from windows_version_info import render_version_info, write_version_info


class WindowsVersionInfoTest(unittest.TestCase):
    def test_resource_contains_product_metadata_and_version(self):
        source = render_version_info("1.2.4")
        self.assertIn("filevers=(1, 2, 4, 0)", source)
        self.assertIn("StringStruct('CompanyName', '成子智能体')", source)
        self.assertIn("StringStruct('OriginalFilename', 'ChengziWeChatCollector.exe')", source)

    def test_invalid_versions_are_rejected(self):
        with self.assertRaises(ValueError):
            render_version_info("1.2")
        with self.assertRaises(ValueError):
            render_version_info("{{VERSION}}")

    def test_writer_creates_parent_directory(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = write_version_info(Path(temporary) / "nested" / "version.txt", "1.2.4")
            self.assertTrue(path.is_file())
            self.assertIn("ProductVersion', '1.2.4'", path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
