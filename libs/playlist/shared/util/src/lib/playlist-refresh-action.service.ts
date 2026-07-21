import { inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DialogService } from '@iptvnator/ui/components';
import {
    DatabaseService,
    type DbOperationEvent,
    isDbAbortError,
    PlaybackPositionService,
    PlaylistRefreshService,
    XtreamPendingRestoreService,
} from '@iptvnator/services';
import { ChannelActions, PlaylistActions } from '@iptvnator/m3u-state';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { PlaylistContextFacade } from './playlist-context.facade';

export interface XtreamRefreshPreparationState {
    playlistId: string;
    operationId: string;
    phase: string;
    current?: number;
    total?: number;
}

export interface PlaylistRefreshActionOptions {
    confirm?: boolean;
    navigateToPlaylist?: boolean;
    notify?: boolean;
}

function isRefreshableM3uPlaylist(playlist: PlaylistMeta): boolean {
    return Boolean(
        !playlist.macAddress &&
        !playlist.portalUrl &&
        (playlist.url || playlist.filePath)
    );
}

@Injectable({ providedIn: 'root' })
export class PlaylistRefreshActionService {
    private readonly router = inject(Router);
    private readonly store = inject(Store);
    private readonly translate = inject(TranslateService);
    private readonly snackBar = inject(MatSnackBar);
    private readonly dialogService = inject(DialogService);
    private readonly databaseService = inject(DatabaseService);
    private readonly playbackPositionService = inject(PlaybackPositionService);
    private readonly playlistRefreshService = inject(PlaylistRefreshService);
    private readonly playlistContext = inject(PlaylistContextFacade);
    private readonly pendingRestoreService = inject(
        XtreamPendingRestoreService
    );

    private readonly refreshPreparationState =
        signal<XtreamRefreshPreparationState | null>(null);

    readonly isRefreshing = signal(false);
    readonly refreshPreparation = this.refreshPreparationState.asReadonly();

    canRefresh(playlist: PlaylistMeta | null): boolean {
        if (!playlist || !window.electron) {
            return false;
        }

        return Boolean(
            playlist.serverUrl || isRefreshableM3uPlaylist(playlist)
        );
    }

    refresh(playlist: PlaylistMeta): void {
        void this.refreshNow(playlist, {
            confirm: true,
            navigateToPlaylist: true,
            notify: true,
        });
    }

    async refreshNow(
        playlist: PlaylistMeta,
        options: PlaylistRefreshActionOptions = {}
    ): Promise<boolean> {
        if (this.isRefreshing()) {
            return false;
        }

        if (playlist.serverUrl) {
            return this.refreshXtream(playlist, options);
        }

        if (isRefreshableM3uPlaylist(playlist)) {
            return this.refreshM3u(playlist, options);
        }

        return false;
    }

    private async refreshXtream(
        item: PlaylistMeta,
        options: PlaylistRefreshActionOptions
    ): Promise<boolean> {
        if (options.confirm !== false) {
            this.dialogService.openConfirmDialog({
                title: this.translate.instant(
                    'HOME.PLAYLISTS.REFRESH_XTREAM_DIALOG.TITLE'
                ),
                message: this.translate.instant(
                    'HOME.PLAYLISTS.REFRESH_XTREAM_DIALOG.MESSAGE'
                ),
                width: '400px',
                onConfirm: () => this.executeXtreamRefresh(item, options),
            });
            return true;
        }

        return this.executeXtreamRefresh(item, options);
    }

    private async executeXtreamRefresh(
        item: PlaylistMeta,
        options: PlaylistRefreshActionOptions
    ): Promise<boolean> {
        if (this.isRefreshing()) {
            return false;
        }

        this.isRefreshing.set(true);
        const operationId =
            this.databaseService.createOperationId('xtream-refresh');
        this.refreshPreparationState.set({
            playlistId: item._id,
            operationId,
            phase: 'collecting-user-data',
        });

        try {
            if (options.notify !== false) {
                this.snackBar.open(
                    this.translate.instant(
                        'HOME.PLAYLISTS.REFRESH_XTREAM_DIALOG.STARTED'
                    ),
                    undefined,
                    { duration: 2000 }
                );
            }
            await this.waitForRefreshPreparationPaint();

            const updateDate = Date.now();
            const [restoreState, playbackPositions] = await Promise.all([
                this.databaseService.deleteXtreamPlaylistContent(item._id, {
                    operationId,
                    onEvent: (event) =>
                        this.updateRefreshPreparationFromEvent(
                            item._id,
                            operationId,
                            event
                        ),
                }),
                this.playbackPositionService.getAllPlaybackPositions(item._id),
                this.databaseService.updateXtreamPlaylistDetails({
                    id: item._id,
                    updateDate,
                }),
            ]);

            this.pendingRestoreService.set(item._id, {
                ...restoreState,
                playbackPositions,
            });

            this.store.dispatch(
                PlaylistActions.updatePlaylistMeta({
                    playlist: { ...item, updateDate },
                })
            );

            if (options.navigateToPlaylist !== false) {
                await this.router.navigate(['/workspace', 'xtreams', item._id]);
            }

            return true;
        } catch (error) {
            if (!isDbAbortError(error)) {
                console.error('Error refreshing Xtream playlist:', error);
                if (options.notify !== false) {
                    this.snackBar.open(
                        this.translate.instant(
                            'HOME.PLAYLISTS.REFRESH_XTREAM_DIALOG.ERROR'
                        ),
                        undefined,
                        { duration: 3000 }
                    );
                }
            }

            return false;
        } finally {
            this.clearRefreshPreparation(operationId);
            this.isRefreshing.set(false);
        }
    }

    private async refreshM3u(
        item: PlaylistMeta,
        options: PlaylistRefreshActionOptions
    ): Promise<boolean> {
        const isActiveM3uRoute =
            this.playlistContext.routeProvider() === 'playlists' &&
            this.playlistContext.resolvedPlaylistId() === item._id;

        this.isRefreshing.set(true);
        if (isActiveM3uRoute) {
            this.store.dispatch(
                ChannelActions.setChannelsLoading({ loading: true })
            );
        }

        try {
            const refreshedPlaylist =
                await this.playlistRefreshService.refreshPlaylist({
                    operationId:
                        this.databaseService.createOperationId(
                            'playlist-refresh'
                        ),
                    playlistId: item._id,
                    title: item.title,
                    url: item.url,
                    filePath: item.filePath,
                });

            this.store.dispatch(
                PlaylistActions.updatePlaylist({
                    playlist: {
                        ...refreshedPlaylist,
                        _id: item._id,
                    },
                    playlistId: item._id,
                })
            );

            if (options.notify !== false) {
                this.snackBar.open(
                    this.translate.instant(
                        'HOME.PLAYLISTS.PLAYLIST_UPDATE_SUCCESS'
                    ),
                    undefined,
                    { duration: 2000 }
                );
            }

            return true;
        } catch (error) {
            if (!isDbAbortError(error)) {
                console.error('Error refreshing playlist:', error);
                if (options.notify !== false) {
                    this.snackBar.open(
                        this.getRefreshErrorMessage(error, item),
                        this.translate.instant('CLOSE'),
                        { duration: 5000 }
                    );
                }
            }

            if (isActiveM3uRoute) {
                this.store.dispatch(
                    ChannelActions.setChannelsLoading({ loading: false })
                );
            }

            return false;
        } finally {
            this.isRefreshing.set(false);
        }
    }

    private getRefreshErrorMessage(error: unknown, item: PlaylistMeta): string {
        if (
            error instanceof Error &&
            error.message?.includes('ENOENT') &&
            item.filePath
        ) {
            return this.translate.instant(
                'HOME.PLAYLISTS.PLAYLIST_UPDATE_FILE_NOT_FOUND'
            );
        }

        return this.translate.instant('HOME.PLAYLISTS.PLAYLIST_UPDATE_ERROR');
    }

    private updateRefreshPreparationFromEvent(
        playlistId: string,
        operationId: string,
        event: DbOperationEvent
    ): void {
        if (event.operationId && event.operationId !== operationId) {
            return;
        }

        this.refreshPreparationState.update((current) => {
            if (!current || current.operationId !== operationId) {
                return current;
            }

            return {
                playlistId,
                operationId,
                phase: event.phase ?? current.phase,
                current: event.current ?? current.current,
                total: event.total ?? current.total,
            };
        });
    }

    private clearRefreshPreparation(operationId: string): void {
        this.refreshPreparationState.update((current) =>
            current?.operationId === operationId ? null : current
        );
    }

    private async waitForRefreshPreparationPaint(): Promise<void> {
        const minimumVisibleDelayMs = 120;

        // Give Angular a paint opportunity before small cached playlists can
        // finish cleanup and clear the preparation state.
        const resolveAfterDelay = (resolve: () => void): void => {
            setTimeout(resolve, minimumVisibleDelayMs);
        };

        if (typeof requestAnimationFrame !== 'function') {
            await new Promise<void>(resolveAfterDelay);
            return;
        }

        await new Promise<void>((resolve) => {
            requestAnimationFrame(() => resolveAfterDelay(resolve));
        });
    }
}
