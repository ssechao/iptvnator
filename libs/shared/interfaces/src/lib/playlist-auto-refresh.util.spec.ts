import {
    DEFAULT_PLAYLIST_AUTO_REFRESH_INTERVAL_HOURS,
    getPlaylistAutoRefreshIntervalHours,
    getPlaylistRefreshReferenceTime,
    isPlaylistAutoRefreshDue,
    normalizePlaylistAutoRefreshIntervalHours,
} from './playlist-auto-refresh.util';

describe('playlist-auto-refresh.util', () => {
    it('normalizes supported refresh intervals and falls back to the default', () => {
        expect(normalizePlaylistAutoRefreshIntervalHours(12)).toBe(12);
        expect(normalizePlaylistAutoRefreshIntervalHours('48')).toBe(48);
        expect(normalizePlaylistAutoRefreshIntervalHours(6)).toBe(
            DEFAULT_PLAYLIST_AUTO_REFRESH_INTERVAL_HOURS
        );
        expect(normalizePlaylistAutoRefreshIntervalHours(undefined)).toBe(
            DEFAULT_PLAYLIST_AUTO_REFRESH_INTERVAL_HOURS
        );
    });

    it('reads updateDate before importDate as the freshness reference', () => {
        expect(
            getPlaylistRefreshReferenceTime({
                importDate: '2026-06-09T00:00:00.000Z',
                updateDate: 1718000000000,
            })
        ).toBe(1718000000000);

        expect(
            getPlaylistRefreshReferenceTime({
                importDate: '2026-06-09T00:00:00.000Z',
            })
        ).toBe(Date.parse('2026-06-09T00:00:00.000Z'));
    });

    it('detects when an enabled playlist interval has elapsed', () => {
        const importedAt = Date.parse('2026-06-09T00:00:00.000Z');

        expect(
            isPlaylistAutoRefreshDue(
                {
                    autoRefresh: true,
                    autoRefreshIntervalHours: 12,
                    importDate: '2026-06-09T00:00:00.000Z',
                },
                importedAt + 12 * 60 * 60 * 1000
            )
        ).toBe(true);

        expect(
            isPlaylistAutoRefreshDue(
                {
                    autoRefresh: true,
                    autoRefreshIntervalHours: 12,
                    importDate: '2026-06-09T00:00:00.000Z',
                },
                importedAt + 11 * 60 * 60 * 1000
            )
        ).toBe(false);
    });

    it('does not refresh disabled playlists', () => {
        expect(
            isPlaylistAutoRefreshDue(
                {
                    autoRefresh: false,
                    autoRefreshIntervalHours:
                        getPlaylistAutoRefreshIntervalHours({}),
                    importDate: '2026-06-09T00:00:00.000Z',
                },
                Date.parse('2026-06-11T00:00:00.000Z')
            )
        ).toBe(false);
    });
});
