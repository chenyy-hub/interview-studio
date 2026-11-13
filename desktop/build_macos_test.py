import importlib.util
import plistlib
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('builder', Path(__file__).with_name('build_macos.py'))
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class HelperLayoutTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.app = Path(self.temp.name) / 'InterviewStudio.app'
        info = self.app / 'Contents/Info.plist'
        info.parent.mkdir(parents=True)
        info.write_bytes(plistlib.dumps({'CFBundleName': 'InterviewStudio', 'CFBundleExecutable': 'InterviewStudio', 'CFBundleIdentifier': 'local.interview.studio'}))
        for suffix in ['', ' (GPU)', ' (Renderer)', ' (Plugin)']:
            name = 'InterviewStudio Helper' + suffix
            helper = self.app / 'Contents/Frameworks' / (name + '.app') / 'Contents'
            (helper / 'MacOS').mkdir(parents=True)
            binary = helper / 'MacOS' / name
            binary.write_text('synthetic executable fixture')
            binary.chmod(0o755)
            identity = 'local.interview.studio.helper' + ('.' + suffix[2:-1] if suffix else '')
            (helper / 'Info.plist').write_bytes(plistlib.dumps({'CFBundleExecutable': name, 'CFBundleIdentifier': identity}))

    def test_valid_helper_layout(self):
        builder.validate_helper_layout(self.app)

    def test_old_helper_folder_is_rejected(self):
        root = self.app / 'Contents/Frameworks'
        (root / 'InterviewStudio Helper.app').rename(root / 'Pika Helper.app')
        with self.assertRaisesRegex(RuntimeError, 'Missing helper app'):
            builder.validate_helper_layout(self.app)

    def test_missing_binary_is_rejected(self):
        (self.app / 'Contents/Frameworks/InterviewStudio Helper.app/Contents/MacOS/InterviewStudio Helper').unlink()
        with self.assertRaisesRegex(RuntimeError, 'Missing helper executable'):
            builder.validate_helper_layout(self.app)

    def test_inconsistent_bundle_name_is_rejected(self):
        info = self.app / 'Contents/Info.plist'
        data = plistlib.loads(info.read_bytes()); data['CFBundleName'] = 'Interview Studio'
        info.write_bytes(plistlib.dumps(data))
        with self.assertRaisesRegex(RuntimeError, 'must agree'):
            builder.validate_helper_layout(self.app)


if __name__ == '__main__':
    unittest.main()
