import { spawnSync } from 'node:child_process';
import process from 'node:process';

const supportedArchitectures = new Set(['arm64', 'x64']);
const forwardedArgs = process.argv.slice(2);
const archFlagIndex = forwardedArgs.indexOf('--arch');
const explicitArch =
    forwardedArgs
        .find((argument) => argument.startsWith('--arch='))
        ?.slice('--arch='.length) ??
    (archFlagIndex >= 0 ? forwardedArgs[archFlagIndex + 1] : undefined);
const architecture =
    explicitArch ??
    process.env.IPTVNATOR_PACKAGE_ARCH ??
    process.env.npm_config_arch ??
    (process.arch === 'arm64' ? 'arm64' : 'x64');

if (process.platform !== 'darwin') {
    console.error('Local macOS app packaging must be run on macOS.');
    process.exit(1);
}

if (!supportedArchitectures.has(architecture)) {
    console.error(
        `Unsupported macOS package architecture "${architecture}". Use arm64 or x64.`
    );
    process.exit(1);
}

const pnpmArgs = [
    'pnpm',
    'nx',
    'run',
    'electron-backend:make',
    '--platform=mac',
    `--arch=${architecture}`,
    '--makerOptionsPath=apps/electron-backend/src/app/options/maker.local-macos.options.json',
    '--publishPolicy=never',
];

const result = spawnSync('corepack', pnpmArgs, {
    cwd: process.cwd(),
    env: {
        ...process.env,
        CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    },
    stdio: 'inherit',
});

if (result.error) {
    console.error(result.error.message);
    process.exit(1);
}

if (result.status !== 0) {
    process.exit(result.status ?? 1);
}

const appDirectory =
    architecture === 'arm64'
        ? 'dist/executables/mac-arm64/IPTVnator.app'
        : 'dist/executables/mac/IPTVnator.app';

console.log(`Local macOS app bundle ready: ${appDirectory}`);
