"""Packaging contract: reject filtered files, external/root resources and omissions."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('package_toy', Path(__file__).with_name('package-toy.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Contract(unittest.TestCase):
    def test_nested_resources(self):
        module.validate({'index.html': b'<script src="./assets/main.js"></script>',
                         'assets/main.js': b'const icon="./icons/power.png";', 'icons/power.png': b'png'})

    def test_reject_bad_packages(self):
        for files in [
            {'main.html': b''},
            {'index.html': b'', 'LICENSE.txt': b'notice'},
            {'index.html': b'<img src="/icons/a.png">'},
            {'index.html': b'<script src="https://example.com/game.js"></script>'},
            {'index.html': b'<img src="./missing.png">'},
            {'index.html': b'', '../escape.md': b''},
        ]:
            with self.subTest(files=list(files)), self.assertRaises(ValueError):
                module.validate(files)


if __name__ == '__main__':
    unittest.main()
