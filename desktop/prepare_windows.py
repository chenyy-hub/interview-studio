"""Apply the same reviewed desktop extension before Windows Electron packaging."""
import json
from pathlib import Path
import sys
from runtime_payload import runtime_payload, VERSION, PRODUCT


def prepare(root):
    if not (root / 'native-module/index.win32-x64-msvc.node').is_file():
        raise RuntimeError('A real Windows x64 native audio module is required')
    additions = runtime_payload(lambda name: (root / name).read_text(encoding='utf-8'))
    package = json.loads(additions['package.json'])
    config = package['build']
    config.update(appId='local.interview.studio', productName=PRODUCT)
    config['files'] = ['desktop', *config['files']]
    config.pop('publish', None)
    config['directories']['output'] = 'release'
    config['win'].update(target=[{'target': 'nsis', 'arch': ['x64']}, {'target': 'portable', 'arch': ['x64']}], requestedExecutionLevel='asInvoker', artifactName='InterviewStudio-Portable-${version}-${arch}.${ext}')
    config['nsis'].update(oneClick=False, perMachine=False, deleteAppDataOnUninstall=False,
                          artifactName='InterviewStudio-Setup-${version}-${arch}.${ext}')
    additions['package.json'] = json.dumps(package, ensure_ascii=False, indent=2).encode()
    for name, content in additions.items():
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    print(f'Windows desktop extension {VERSION} prepared; native x64 audio module exists')


if __name__ == '__main__':
    prepare(Path(sys.argv[1]).resolve())
