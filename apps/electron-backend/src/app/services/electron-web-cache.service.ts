import { rmSync } from 'node:fs';
import { join } from 'node:path';

type RemoveDirectory = (
    path: string,
    options: { force: true; recursive: true }
) => void;

export function removeLegacyServiceWorkerData(
    userDataPath: string,
    removeDirectory: RemoveDirectory = rmSync
): void {
    removeDirectory(join(userDataPath, 'Service Worker'), {
        force: true,
        recursive: true,
    });
}
