#!/usr/bin/env python3
"""Build a local derivative from the official Pika 3.4.0 arm64 release.

Preserve upstream native modules; append reviewed source to its ASAR and keep
file-integrity checks enabled. No Gatekeeper or quarantine settings are changed.
"""
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import struct
import subprocess
import sys
from runtime_payload import runtime_payload, VERSION

ROOT = Path(__file__).resolve().parent.parent
PRODUCT = 'InterviewStudio'
BUNDLE_ID = 'local.interview.studio'


def validate_helper_layout(app_path):
    """Check the paths Electron resolves before it can run any JavaScript."""
    info = plistlib.loads((app_path / 'Contents/Info.plist').read_bytes())
    product = info['CFBundleExecutable']
    if info['CFBundleName'] != product or app_path.stem != product:
        raise RuntimeError('App folder, bundle name and executable name must agree')
    for suffix in ['', ' (GPU)', ' (Renderer)', ' (Plugin)']:
        helper_name = f'{product} Helper{suffix}'
        helper = app_path / 'Contents/Frameworks' / f'{helper_name}.app'
        if not helper.is_dir():
            raise RuntimeError(f'Missing helper app: {helper_name}')
        metadata = plistlib.loads((helper / 'Contents/Info.plist').read_bytes())
        binary = helper / 'Contents/MacOS' / helper_name
        if metadata['CFBundleExecutable'] != helper_name or not binary.is_file() or not os.access(binary, os.X_OK):
            raise RuntimeError(f'Missing helper executable: {helper_name}')
        expected = info['CFBundleIdentifier'] + '.helper' + ('.' + suffix[2:-1] if suffix else '')
        if metadata['CFBundleIdentifier'] != expected:
            raise RuntimeError(f'Helper bundle identity does not match app: {helper_name}')


def brand_bundle(app_path, info):
    previous_executable = info['CFBundleExecutable']
    macos = app_path / 'Contents/MacOS'
    (macos / previous_executable).rename(macos / PRODUCT)
    frameworks = app_path / 'Contents/Frameworks'
    for helper in sorted(frameworks.glob(f'{previous_executable} Helper*.app')):
        metadata_path = helper / 'Contents/Info.plist'
        metadata = plistlib.loads(metadata_path.read_bytes())
        previous_helper = metadata['CFBundleExecutable']
        helper_name = previous_helper.replace(previous_executable, PRODUCT, 1)
        (helper / 'Contents/MacOS' / previous_helper).rename(helper / 'Contents/MacOS' / helper_name)
        suffix = metadata['CFBundleIdentifier'].split('.helper', 1)[1]
        metadata.update(CFBundleName=helper_name, CFBundleDisplayName=helper_name,
                        CFBundleExecutable=helper_name, CFBundleIdentifier=BUNDLE_ID + '.helper' + suffix)
        with metadata_path.open('wb') as file:
            plistlib.dump(metadata, file)
        helper.rename(frameworks / f'{helper_name}.app')
    info.update(CFBundleDisplayName='面试工作室', CFBundleName=PRODUCT,
                CFBundleExecutable=PRODUCT, CFBundleIdentifier=BUNDLE_ID)


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise RuntimeError(f'Unexpected upstream code shape: {old[:80]}')
    return text.replace(old, new, 1)


def build(base, output):
    if output.exists():
        raise RuntimeError('Output already exists; choose a new output app path')
    if output.stem != PRODUCT:
        raise RuntimeError(f'The app bundle must be named {PRODUCT}.app')
    shutil.copytree(base, output, symlinks=True)
    archive = output / 'Contents/Resources/app.asar'
    with archive.open('rb') as source:
        raw = struct.unpack('<4I', source.read(16))
        header = json.loads(source.read(raw[3]))
        data_start = 8 + raw[1]

        def entry(name):
            current = header
            for part in name.split('/'):
                current = current['files'][part]
            return current

        def read(name):
            meta = entry(name)
            source.seek(data_start + int(meta['offset']))
            return source.read(meta['size']).decode()

        additions = runtime_payload(read)

        offset = archive.stat().st_size - data_start
        for name, contents in additions.items():
            directory = header
            parts = name.split('/')
            for part in parts[:-1]:
                directory = directory.setdefault('files', {}).setdefault(part, {'files': {}})
            directory.setdefault('files', {})[parts[-1]] = {
                'size': len(contents), 'offset': str(offset),
                'integrity': {'algorithm': 'SHA256', 'hash': hashlib.sha256(contents).hexdigest(), 'blockSize': 4194304,
                              'blocks': [hashlib.sha256(contents[i:i+4194304]).hexdigest() for i in range(0, len(contents), 4194304)]},
            }
            offset += len(contents)
        new_header = json.dumps(header, ensure_ascii=False, separators=(',', ':')).encode()
        padding = (-len(new_header)) % 4
        pickle_payload = struct.pack('<I', len(new_header)) + new_header + b'\x00' * padding
        header_pickle = struct.pack('<I', len(pickle_payload)) + pickle_payload
        prefix = struct.pack('<II', 4, len(header_pickle)) + header_pickle
        temp = archive.with_suffix('.new')
        with temp.open('wb') as dest:
            dest.write(prefix)
            source.seek(data_start)
            shutil.copyfileobj(source, dest, 4 * 1024 * 1024)
            for contents in additions.values():
                dest.write(contents)
    temp.replace(archive)

    plist_path = output / 'Contents/Info.plist'
    with plist_path.open('rb') as file:
        plist = plistlib.load(file)
    brand_bundle(output, plist)
    plist['CFBundleShortVersionString'] = VERSION
    plist['CFBundleVersion'] = VERSION
    plist['ElectronAsarIntegrity']['Resources/app.asar']['hash'] = hashlib.sha256(new_header).hexdigest()
    plist['NSMicrophoneUsageDescription'] = '面试工作室需要麦克风用于你主动开启的实时转写。'
    plist['NSScreenCaptureDescription'] = '面试工作室需要屏幕录制权限来采集系统音频和截取你选择的屏幕内容。'
    plist['NSAudioCaptureUsageDescription'] = '仅在你主动开始采音后捕获系统播放声音，用于实时转写会议对方发言。'
    with plist_path.open('wb') as file:
        plistlib.dump(plist, file)
    validate_helper_layout(output)
    print('Native helper layout verification passed')
    print('App files built:', output)
    print('ASAR header integrity:', hashlib.sha256(new_header).hexdigest())
    result = subprocess.run(['/usr/bin/codesign', '--force', '--deep', '--sign', '-', '--entitlements', str(ROOT / 'assets/entitlements.mac.plist'), str(output)], capture_output=True, text=True)
    print('Ad-hoc signing:', result.returncode)
    if result.returncode:
        print(result.stderr.strip())
        raise RuntimeError('Local code signing failed')
    subprocess.run(['/usr/bin/codesign', '--verify', '--deep', '--strict', str(output)], check=True)
    print('Code signature verification passed')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('Usage: build_macos.py PATH_TO_PIKA_APP OUTPUT_APP')
    build(Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve())
