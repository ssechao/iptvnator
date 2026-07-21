jest.mock('electron', () => ({
    app: {
        getPath: jest.fn(() => '/tmp'),
    },
    BrowserWindow: jest.fn(),
    dialog: {
        showOpenDialog: jest.fn(),
    },
    ipcMain: {
        handle: jest.fn(),
    },
    shell: {
        openPath: jest.fn(),
        showItemInFolder: jest.fn(),
    },
}));

jest.mock('../../database/connection', () => ({
    getDatabase: jest.fn(),
}));

import { createServer, Server } from 'http';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
    buildDownloadHeaders,
    downloadFileToPath,
} from './downloads.events';

describe('downloads.events download helpers', () => {
    it('builds request headers without empty values', () => {
        expect(
            buildDownloadHeaders(
                {
                    userAgent: ' CustomAgent/1.0 ',
                    referer: '  ',
                    origin: ' https://portal.example ',
                },
                'DefaultAgent/1.0'
            )
        ).toEqual({
            'User-Agent': 'CustomAgent/1.0',
            Origin: 'https://portal.example',
        });
    });

    it('uses the default user agent when the playlist has none', () => {
        expect(buildDownloadHeaders(undefined, 'DefaultAgent/1.0')).toEqual({
            'User-Agent': 'DefaultAgent/1.0',
        });
    });

    it('follows redirects, sends headers, writes the file, and reports progress', async () => {
        const payload = Buffer.from('downloaded via local redirect');
        const receivedHeaders: Array<Record<string, string | string[] | undefined>> =
            [];
        const server = createServer((request, response) => {
            if (request.url === '/redirect') {
                response.writeHead(302, { Location: '/file' });
                response.end();
                return;
            }

            if (request.url === '/file') {
                receivedHeaders.push(request.headers);
                response.writeHead(200, {
                    'Content-Length': String(payload.length),
                });
                response.end(payload);
                return;
            }

            response.writeHead(404);
            response.end();
        });
        const tempDirectory = mkdtempSync(join(tmpdir(), 'iptvnator-download-'));

        try {
            const port = await listen(server);
            const progress: Array<{
                transferredBytes: number;
                totalBytes: number | null;
            }> = [];
            const result = await downloadFileToPath({
                url: `http://127.0.0.1:${port}/redirect`,
                directory: tempDirectory,
                fileName: 'movie file.mkv',
                headers: {
                    'User-Agent': 'IPTVnatorTest/1.0',
                    'X-Test-Header': 'kept',
                },
                signal: new AbortController().signal,
                onProgress: (event) => progress.push(event),
            });

            expect(result.filename).toBe('movie file.mkv');
            expect(readFileSync(result.path)).toEqual(payload);
            expect(receivedHeaders).toHaveLength(1);
            expect(receivedHeaders[0]['user-agent']).toBe('IPTVnatorTest/1.0');
            expect(receivedHeaders[0]['x-test-header']).toBe('kept');
            expect(progress.at(-1)).toEqual({
                transferredBytes: payload.length,
                totalBytes: payload.length,
            });
        } finally {
            await close(server);
            rmSync(tempDirectory, { force: true, recursive: true });
        }
    });
});

function listen(server: Server): Promise<number> {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (typeof address === 'object' && address) {
                resolve(address.port);
                return;
            }

            reject(new Error('Failed to listen on a local port'));
        });
    });
}

function close(server: Server): Promise<void> {
    return new Promise((resolve, reject) => {
        server.close((error) => {
            if (error) {
                reject(error);
                return;
            }

            resolve();
        });
    });
}
