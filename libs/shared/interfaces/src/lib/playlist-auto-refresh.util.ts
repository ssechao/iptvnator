import { Playlist } from './playlist.interface';

export const PLAYLIST_AUTO_REFRESH_INTERVAL_OPTIONS = [
    12, 24, 48, 168,
] as const;
export const DEFAULT_PLAYLIST_AUTO_REFRESH_INTERVAL_HOURS = 24;

const HOURS_TO_MS = 60 * 60 * 1000;

export function normalizePlaylistAutoRefreshIntervalHours(
    value: unknown
): number {
    const parsed =
        typeof value === 'number'
            ? value
            : typeof value === 'string' && value.trim() !== ''
              ? Number(value)
              : Number.NaN;

    return PLAYLIST_AUTO_REFRESH_INTERVAL_OPTIONS.includes(
        parsed as (typeof PLAYLIST_AUTO_REFRESH_INTERVAL_OPTIONS)[number]
    )
        ? parsed
        : DEFAULT_PLAYLIST_AUTO_REFRESH_INTERVAL_HOURS;
}

export function getPlaylistAutoRefreshIntervalHours(
    playlist: Pick<Playlist, 'autoRefreshIntervalHours'>
): number {
    return normalizePlaylistAutoRefreshIntervalHours(
        playlist.autoRefreshIntervalHours
    );
}

export function getPlaylistRefreshReferenceTime(
    playlist: Pick<Playlist, 'importDate' | 'updateDate'>
): number | null {
    if (
        typeof playlist.updateDate === 'number' &&
        Number.isFinite(playlist.updateDate) &&
        playlist.updateDate > 0
    ) {
        return playlist.updateDate;
    }

    const importedAt = Date.parse(playlist.importDate);
    return Number.isNaN(importedAt) ? null : importedAt;
}

export function isPlaylistAutoRefreshDue(
    playlist: Pick<
        Playlist,
        'autoRefresh' | 'autoRefreshIntervalHours' | 'importDate' | 'updateDate'
    >,
    now = Date.now()
): boolean {
    if (!playlist.autoRefresh) {
        return false;
    }

    const referenceTime = getPlaylistRefreshReferenceTime(playlist);
    if (referenceTime === null) {
        return true;
    }

    const intervalMs =
        getPlaylistAutoRefreshIntervalHours(playlist) * HOURS_TO_MS;
    return now - referenceTime >= intervalMs;
}
