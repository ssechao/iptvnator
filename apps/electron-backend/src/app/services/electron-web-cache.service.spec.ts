import { join } from 'node:path';
import { removeLegacyServiceWorkerData } from './electron-web-cache.service';

describe('removeLegacyServiceWorkerData', () => {
    it('removes only the Chromium service worker directory', () => {
        const removeDirectory = jest.fn();
        const userDataPath = join('tmp', 'iptvnator-profile');

        removeLegacyServiceWorkerData(userDataPath, removeDirectory);

        expect(removeDirectory).toHaveBeenCalledWith(
            join(userDataPath, 'Service Worker'),
            {
                force: true,
                recursive: true,
            }
        );
        expect(removeDirectory).toHaveBeenCalledTimes(1);
    });
});
