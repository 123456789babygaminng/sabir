// Builds the standalone app: dist/Sabir-win32-x64/Sabir.exe
// Run: node tools/build.js   (SABIR_OUT=release to build next to a running dist copy)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const STAGE = path.join(ROOT, 'build', 'res');
const OUT = path.join(ROOT, process.env.SABIR_OUT || 'dist');

(async () => {
  const { packager } = await import('@electron/packager');
  // the helper ships self-contained (single file), so users do not need the .NET runtime
  const UIA_OUT = path.join(ROOT, 'build', 'uia-sc');
  execFileSync('dotnet', ['publish', 'uia/SabirUia.csproj', '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true',
    '-p:PublishSingleFile=true', '-p:IncludeNativeLibrariesForSelfExtract=true', '-p:DebugType=none', '-o', UIA_OUT], { cwd: ROOT, stdio: 'inherit' });
  // helper exe and bridge live next to the app (not inside app.asar) so other processes can start them
  fs.rmSync(STAGE, { recursive: true, force: true });
  fs.mkdirSync(STAGE, { recursive: true });
  fs.mkdirSync(path.join(STAGE, 'uia'), { recursive: true });
  fs.copyFileSync(path.join(UIA_OUT, 'SabirUia.exe'), path.join(STAGE, 'uia', 'SabirUia.exe'));
  fs.cpSync(path.join(ROOT, 'bridge'), path.join(STAGE, 'bridge'), { recursive: true });

  const keep = [/^\/main\.js$/, /^\/package\.json$/, /^\/core(\/|$)/, /^\/ui(\/|$)/, /^\/assets(\/|$)/];
  const out = await packager({
    dir: ROOT,
    out: OUT,
    name: 'Sabir',
    executableName: 'Sabir',
    platform: 'win32',
    arch: 'x64',
    overwrite: true,
    asar: true,
    icon: path.join(ROOT, 'assets', 'icon.ico'),
    extraResource: [path.join(STAGE, 'uia'), path.join(STAGE, 'bridge')],
    appCopyright: 'Sabir',
    win32metadata: { CompanyName: 'Sabir', FileDescription: 'Sabir', ProductName: 'Sabir', InternalName: 'Sabir', OriginalFilename: 'Sabir.exe' },
    ignore: (p) => p !== '' && !keep.some((r) => r.test(p.replace(/\\/g, '/'))),
    prune: true,
  });
  console.log('built', out.join(', '));
})().catch((e) => { console.error(e); process.exit(1); });
