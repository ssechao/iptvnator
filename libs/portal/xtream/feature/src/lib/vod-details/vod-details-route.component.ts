import { Location, NgTemplateOutlet, SlicePipe } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    OnDestroy,
    OnInit,
    computed,
    effect,
    inject,
    signal,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ContentHeroComponent } from '@iptvnator/ui/components';
import { SafePipe } from '@iptvnator/pipes';
import {
    PORTAL_EXTERNAL_PLAYBACK,
    PORTAL_PLAYBACK_POSITIONS,
    PORTAL_PLAYER,
    createLogger,
    getPortalPlaybackProgressPercent,
    routeParamSignal,
} from '@iptvnator/portal/shared/util';
import {
    TmdbCatalogEntityRole,
    TmdbMovieMetadataService,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import {
    type PlaybackFallbackRequest,
    PortalInlinePlayerComponent,
} from '@iptvnator/ui/playback';
import { DownloadsService, SettingsStore } from '@iptvnator/services';
import {
    PlaybackPositionData,
    PlayerContentInfo,
    ResolvedPortalPlayback,
    XtreamCategory,
    XtreamVodDetails,
    XtreamVodStream,
    getXtreamVodInfo,
} from '@iptvnator/shared/interfaces';
import {
    buildXtreamVodFallbackViewModel,
    hasUsableXtreamVodMetadata,
} from './vod-details-fallback.util';
import {
    SimilarVodReason,
    SimilarVodRecommendation,
    buildSimilarVodRecommendations,
} from './vod-similar-recommendations.util';

@Component({
    templateUrl: './vod-details-route.component.html',
    styleUrls: [
        '../../../../../../ui/components/src/lib/styles/detail-view.scss',
        './vod-details-route.component.scss',
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        ContentHeroComponent,
        MatIcon,
        NgTemplateOutlet,
        SafePipe,
        SlicePipe,
        TranslateModule,
        PortalInlinePlayerComponent,
    ],
})
export class VodDetailsRouteComponent implements OnInit, OnDestroy {
    private readonly location = inject(Location);
    private readonly router = inject(Router);
    private readonly settingsStore = inject(SettingsStore);
    private readonly tmdbMetadata = inject(TmdbMovieMetadataService);
    private readonly route = inject(ActivatedRoute);
    private readonly xtreamStore = inject(XtreamStore);
    private readonly playbackPositions = inject(PORTAL_PLAYBACK_POSITIONS);
    private readonly downloadsService = inject(DownloadsService);
    private readonly externalPlayback = inject(PORTAL_EXTERNAL_PLAYBACK);
    private readonly portalPlayer = inject(PORTAL_PLAYER);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translateService = inject(TranslateService);
    private readonly logger = createLogger('VodDetailsRoute');
    private readonly detailsInitKey = signal<string | null>(null);
    private readonly backdropBackfillKey = signal<string | null>(null);
    private readonly tmdbSimilarMoviesKey = signal<string | null>(null);
    private readonly tmdbSimilarMovies = signal<SimilarVodRecommendation[]>([]);
    readonly inlinePlayback = signal<ResolvedPortalPlayback | null>(null);
    readonly vodPlaybackPosition = signal<PlaybackPositionData | null>(null);
    readonly selectedVodId = routeParamSignal<number>(
        this.route,
        'vodId',
        (value) => Number(value)
    );
    readonly selectedCategoryId = routeParamSignal<string>(
        this.route,
        'categoryId',
        (value) => value ?? ''
    );

    readonly theme = this.settingsStore.theme;
    readonly isElectron = this.downloadsService.isAvailable;

    readonly isFavorite = this.xtreamStore.isFavorite;
    readonly selectedItem = computed(
        () =>
            this.xtreamStore.selectedItem() as unknown as XtreamVodDetails | null
    );
    readonly selectedCategory = computed<Partial<XtreamCategory> | null>(() => {
        const categoryId = this.selectedCategoryId();
        if (!categoryId) {
            return null;
        }

        return (
            this.xtreamStore
                .vodCategories()
                .find(
                    (category) =>
                        String(
                            (
                                category as XtreamCategory & {
                                    id?: string | number;
                                }
                            ).category_id ??
                                (
                                    category as XtreamCategory & {
                                        id?: string | number;
                                    }
                                ).id
                        ) === String(categoryId)
                ) ?? null
        );
    });
    readonly selectedCatalogItem = computed<
        | (Partial<XtreamVodStream> & {
              id?: string | number;
              poster_url?: string;
              title?: string;
              xtream_id?: string | number;
          })
        | null
    >(() => {
        const vodId = this.selectedVodId();
        if (!Number.isFinite(vodId) || vodId <= 0) {
            return null;
        }

        return (
            this.xtreamStore.vodStreams().find(
                (item) =>
                    Number(
                        (
                            item as XtreamVodStream & {
                                id?: string | number;
                                xtream_id?: string | number;
                            }
                        ).xtream_id ??
                            (
                                item as XtreamVodStream & {
                                    id?: string | number;
                                }
                            ).stream_id ??
                            (
                                item as XtreamVodStream & {
                                    id?: string | number;
                                }
                            ).id
                    ) === vodId
            ) ?? null
        );
    });
    readonly selectedVodInfo = computed(() => {
        const item = this.selectedItem();
        return item && hasUsableXtreamVodMetadata(item)
            ? getXtreamVodInfo(item)
            : null;
    });
    readonly fallbackView = computed(() => {
        const item = this.selectedItem();
        if (!item || this.selectedVodInfo()) {
            return null;
        }

        return buildXtreamVodFallbackViewModel({
            vodDetails: item,
            catalogItem: this.selectedCatalogItem(),
            category: this.selectedCategory(),
            vodId: this.selectedVodId(),
        });
    });
    readonly isLoadingDetails = this.xtreamStore.isLoadingDetails;
    readonly detailsError = this.xtreamStore.detailsError;
    private lastSaveTime = 0;
    private unsubscribePositionUpdates: (() => void) | null = null;
    readonly matchedExternalPlayback = computed(() => {
        const session = this.externalPlayback.activeSession();
        const vodId = this.selectedVodId();
        const playlistId = this.xtreamStore.currentPlaylist()?.id;

        if (
            !session?.contentInfo ||
            !playlistId ||
            session.status === 'error' ||
            session.status === 'closed'
        ) {
            return null;
        }

        const contentInfo = session.contentInfo;
        if (
            contentInfo.playlistId !== playlistId ||
            contentInfo.contentType !== 'vod' ||
            contentInfo.contentXtreamId !== vodId
        ) {
            return null;
        }

        return session;
    });
    readonly externalPrimaryLabel = computed(() => {
        const session = this.matchedExternalPlayback();
        if (!session) {
            return null;
        }

        const player = session.player.toUpperCase();
        switch (session.status) {
            case 'launching':
                return `Opening in ${player}...`;
            case 'opened':
            case 'playing':
                return `Stop ${player}`;
            default:
                return null;
        }
    });
    readonly externalPrimaryIcon = computed(() => {
        const session = this.matchedExternalPlayback();
        switch (session?.status) {
            case 'launching':
                return 'hourglass_top';
            case 'opened':
            case 'playing':
                return 'stop_circle';
            default:
                return 'play_arrow';
        }
    });
    readonly isExternalLaunchPending = computed(
        () => this.matchedExternalPlayback()?.status === 'launching'
    );
    readonly isExternalStopAction = computed(() => {
        const status = this.matchedExternalPlayback()?.status;
        return status === 'opened' || status === 'playing';
    });
    readonly externalPrimaryButtonState = computed(() => {
        if (this.isExternalLaunchPending()) {
            return 'launching';
        }

        return this.isExternalStopAction() ? 'stop' : 'idle';
    });
    readonly vodPlaybackProgress = computed(() =>
        getPortalPlaybackProgressPercent(this.vodPlaybackPosition())
    );
    readonly similarMovies = computed(() => {
        const enrichedMovies = this.tmdbSimilarMovies();
        if (enrichedMovies.length > 0) {
            return enrichedMovies;
        }

        return buildSimilarVodRecommendations({
            currentVodId: this.selectedVodId(),
            currentDetails: this.selectedItem() as
                | (XtreamVodDetails & Partial<XtreamVodStream>)
                | null,
            currentCatalogItem: this.selectedCatalogItem(),
            currentCategoryId: this.selectedCategoryId(),
            candidates: this.xtreamStore.vodStreams(),
        });
    });

    readonly hasPlaybackPosition = computed(() => {
        const inProgress =
            this.vodPlaybackProgress() > 0 && this.vodPlaybackProgress() < 90;
        this.logger.debug('hasPlaybackPosition check', {
            vodId: this.selectedVodId(),
            inProgress,
        });
        return inProgress;
    });

    readonly isDownloaded = computed(() => {
        const vodId = this.selectedVodId();
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        if (!playlistId) return false;
        this.downloadsService.downloads();
        return this.downloadsService.isDownloaded(vodId, playlistId, 'vod');
    });

    readonly isDownloading = computed(() => {
        const vodId = this.selectedVodId();
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        if (!playlistId) return false;
        this.downloadsService.downloads();
        return this.downloadsService.isDownloading(vodId, playlistId, 'vod');
    });

    constructor() {
        effect(() => {
            const playlistId = this.xtreamStore.currentPlaylist()?.id;
            const vodId = this.selectedVodId();
            this.initializeVodDetailsIfNeeded(playlistId, vodId);
        });

        effect(() => {
            const settings = this.settingsStore.getSettings();
            const tmdbCredential = settings.tmdbApiKey?.trim() ?? '';
            const playlistId = this.xtreamStore.currentPlaylist()?.id ?? '';
            const vodId = this.selectedVodId();
            const currentDetails = this.selectedItem() as
                | (XtreamVodDetails & Partial<XtreamVodStream>)
                | null;
            const currentCatalogItem = this.selectedCatalogItem();
            const candidates = this.xtreamStore.vodStreams();

            if (
                !tmdbCredential ||
                !currentDetails ||
                !Number.isFinite(vodId) ||
                vodId <= 0 ||
                candidates.length === 0
            ) {
                this.tmdbSimilarMoviesKey.set(null);
                this.tmdbSimilarMovies.set([]);
                return;
            }

            const info = getXtreamVodInfo(currentDetails);
            const tmdbKey = [
                playlistId,
                vodId,
                settings.language,
                hashMetadataCredential(tmdbCredential),
                info?.tmdb_id ?? '',
                info?.name ?? currentDetails.movie_data?.name ?? '',
                candidates.length,
            ].join(':');

            if (this.tmdbSimilarMoviesKey() === tmdbKey) {
                return;
            }

            this.tmdbSimilarMoviesKey.set(tmdbKey);
            this.tmdbSimilarMovies.set([]);
            void this.loadTmdbSimilarMovies({
                key: tmdbKey,
                vodId,
                currentDetails,
                currentCatalogItem,
                candidates,
                language: settings.language,
            });
        });

        effect(() => {
            const playlistId = this.xtreamStore.currentPlaylist()?.id;
            const vodId = this.selectedVodId();
            const backdropUrl =
                this.selectedVodInfo()?.backdrop_path?.[0]?.trim();

            if (
                !playlistId ||
                !Number.isFinite(vodId) ||
                vodId <= 0 ||
                !backdropUrl
            ) {
                return;
            }

            const backfillKey = `${playlistId}:${vodId}:${backdropUrl}`;
            if (this.backdropBackfillKey() === backfillKey) {
                return;
            }

            this.backdropBackfillKey.set(backfillKey);
            void this.xtreamStore.backfillContentBackdrop({
                xtreamId: vodId,
                contentType: 'movie',
                playlist: this.xtreamStore.currentPlaylist,
                backdropUrl,
            });
        });

        if (window.electron?.onPlaybackPositionUpdate) {
            this.unsubscribePositionUpdates =
                window.electron.onPlaybackPositionUpdate(
                    (data: PlaybackPositionData) => {
                        const playlistId =
                            this.xtreamStore.currentPlaylist()?.id;
                        const vodId = this.selectedVodId();

                        if (
                            data.contentType !== 'vod' ||
                            data.playlistId !== playlistId ||
                            data.contentXtreamId !== vodId
                        ) {
                            return;
                        }

                        this.vodPlaybackPosition.set(data);
                    }
                );
        }
    }

    ngOnInit(): void {
        const currentPlaylist = this.xtreamStore.currentPlaylist();
        if (!currentPlaylist?.id) {
            this.logger.warn('Deferring VOD details init: playlist not ready');
            return;
        }
        this.initializeVodDetailsIfNeeded(
            currentPlaylist.id,
            this.selectedVodId()
        );
    }

    ngOnDestroy(): void {
        this.inlinePlayback.set(null);
        this.unsubscribePositionUpdates?.();
        this.xtreamStore.setSelectedItem(null);
    }

    playVod(vodItem: XtreamVodDetails): void {
        const info = getXtreamVodInfo(vodItem);
        this.addToRecentlyViewed();
        const streamUrl = this.xtreamStore.constructVodStreamUrl(vodItem);
        const routeVodId = this.selectedVodId();
        const id =
            Number.isFinite(routeVodId) && routeVodId > 0
                ? routeVodId
                : Number(
                      vodItem.movie_data?.stream_id ||
                          (vodItem as { stream_id?: number }).stream_id
                  );

        this.logger.debug('playVod resolved ID', { id, vodItem });

        const contentInfo: PlayerContentInfo = {
            playlistId: this.xtreamStore.currentPlaylist().id,
            contentXtreamId: id,
            contentType: 'vod',
        };
        const playback: ResolvedPortalPlayback = {
            streamUrl,
            title: info?.name ?? vodItem.movie_data?.name,
            thumbnail: info?.movie_image,
            contentInfo,
        };

        this.startPlayback(playback);
    }

    resumeVod(vodItem: XtreamVodDetails): void {
        const info = getXtreamVodInfo(vodItem);
        this.addToRecentlyViewed();
        const vodId = this.selectedVodId();
        const position = this.vodPlaybackPosition();
        const streamUrl = this.xtreamStore.constructVodStreamUrl(vodItem);

        const contentInfo: PlayerContentInfo = {
            playlistId: this.xtreamStore.currentPlaylist().id,
            contentXtreamId: vodId,
            contentType: 'vod',
        };
        const playback: ResolvedPortalPlayback = {
            streamUrl,
            title: info?.name ?? vodItem.movie_data?.name,
            thumbnail: info?.movie_image,
            startTime: position?.positionSeconds,
            contentInfo,
        };

        this.startPlayback(playback);
    }

    onPrimaryAction(vodItem: XtreamVodDetails): void {
        if (this.isExternalStopAction()) {
            void this.stopExternalPlayback();
            return;
        }

        if (this.hasPlaybackPosition()) {
            this.resumeVod(vodItem);
            return;
        }

        this.playVod(vodItem);
    }

    async stopExternalPlayback(): Promise<void> {
        await this.externalPlayback.closeSession(
            this.matchedExternalPlayback()
        );
    }

    formatPosition(): string {
        const position = this.vodPlaybackPosition();
        if (!position) return '';

        const date = new Date(0);
        date.setSeconds(position.positionSeconds);
        const timeString = date.toISOString().substr(11, 8);
        return timeString.startsWith('00:') ? timeString.substr(3) : timeString;
    }

    toggleFavorite(): void {
        this.xtreamStore.toggleFavorite(
            this.selectedVodId(),
            this.xtreamStore.currentPlaylist().id,
            'movie',
            this.selectedVodInfo()?.backdrop_path?.[0]
        );
    }

    goBack(): void {
        this.closeInlinePlayer();
        this.location.back();
    }

    closeInlinePlayer(): void {
        this.inlinePlayback.set(null);
        this.lastSaveTime = 0;
    }

    handleInlineTimeUpdate(event: {
        currentTime: number;
        duration: number;
    }): void {
        const playback = this.inlinePlayback();
        if (!playback?.contentInfo) return;

        const now = Date.now();
        if (now - this.lastSaveTime <= 15000) return;

        this.lastSaveTime = now;
        const position: PlaybackPositionData = {
            ...playback.contentInfo,
            positionSeconds: Math.floor(event.currentTime),
            durationSeconds: Math.floor(event.duration),
        };
        void this.playbackPositions.savePlaybackPosition(
            playback.contentInfo.playlistId,
            position
        );
        this.vodPlaybackPosition.set(position);
    }

    showCopyNotification(): void {
        this.snackBar.open(
            this.translateService.instant('PORTALS.STREAM_URL_COPIED'),
            null,
            {
                duration: 2000,
            }
        );
    }

    handleExternalFallbackRequest(request: PlaybackFallbackRequest): void {
        void this.portalPlayer.openExternalPlayback(
            request.playback,
            request.player
        );
    }

    getSimilarReasonLabelKey(
        reason: SimilarVodReason,
        item?: Pick<SimilarVodRecommendation, 'reasonNames'>
    ): string {
        const suffix = this.getSimilarReasonName(reason, item) ? '_NAMED' : '';
        return `XTREAM.SIMILAR_REASON_${reason.toUpperCase()}${suffix}`;
    }

    getSimilarReasonLabelParams(
        reason: SimilarVodReason,
        item: Pick<SimilarVodRecommendation, 'reasonNames'>
    ): { name: string } {
        return {
            name: this.getSimilarReasonName(reason, item) ?? '',
        };
    }

    getPersonNames(value: string | null | undefined): string[] {
        return splitPersonNames(value);
    }

    getSimilarReasonName(
        reason: SimilarVodReason,
        item?: Pick<SimilarVodRecommendation, 'reasonNames'>
    ): string | null {
        const names = item?.reasonNames?.[reason]
            ?.map((name) => name.trim())
            .filter(Boolean);
        if (!names || names.length === 0) {
            return null;
        }

        return names.slice(0, 2).join(', ');
    }

    isCatalogEntityReason(
        reason: SimilarVodReason
    ): reason is TmdbCatalogEntityRole {
        return (
            reason === 'actor' ||
            reason === 'director' ||
            reason === 'producer' ||
            reason === 'writer' ||
            reason === 'company' ||
            reason === 'genre'
        );
    }

    openPersonMovies(
        role: TmdbCatalogEntityRole,
        name: string,
        event?: Event
    ): void {
        event?.preventDefault();
        event?.stopPropagation();

        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        const trimmedName = name.trim();
        if (!playlistId || !trimmedName) {
            return;
        }

        void this.router.navigate([
            '/workspace',
            'xtreams',
            playlistId,
            'vod',
            'person',
            role,
            trimmedName,
        ]);
    }

    openSimilarReason(
        event: Event,
        reason: SimilarVodReason,
        item: Pick<SimilarVodRecommendation, 'reasonNames'>
    ): void {
        const name = this.getSimilarReasonName(reason, item)
            ?.split(',')[0]
            ?.trim();
        if (!name || !this.isCatalogEntityReason(reason)) {
            return;
        }

        this.openPersonMovies(reason, name, event);
    }

    openRecommendation(item: { streamId: number; categoryId: string }): void {
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        const categoryId = item.categoryId || this.selectedCategoryId();
        if (!playlistId || !categoryId) {
            return;
        }

        void this.router.navigate([
            '/workspace',
            'xtreams',
            playlistId,
            'vod',
            categoryId,
            item.streamId,
        ]);
    }

    handleRecommendationKeydown(
        event: KeyboardEvent,
        item: { streamId: number; categoryId: string }
    ): void {
        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }

        event.preventDefault();
        this.openRecommendation(item);
    }

    async downloadVod(vodItem: XtreamVodDetails): Promise<void> {
        const info = getXtreamVodInfo(vodItem);
        const streamUrl = this.xtreamStore.constructVodStreamUrl(vodItem);
        const routeVodId = this.selectedVodId();
        const id =
            Number.isFinite(routeVodId) && routeVodId > 0
                ? routeVodId
                : Number(
                      vodItem.movie_data?.stream_id ||
                          (vodItem as { stream_id?: number }).stream_id
                  );

        const playlist = this.xtreamStore.currentPlaylist();

        await this.downloadsService.startDownload({
            playlistId: playlist.id,
            xtreamId: id,
            contentType: 'vod',
            title: info?.name ?? vodItem.movie_data?.name ?? 'Unknown',
            url: streamUrl,
            posterUrl: info?.movie_image,
            headers: {
                userAgent: playlist.userAgent,
                referer: playlist.referrer,
                origin: playlist.origin,
            },
        });
    }

    async playFromLocal(): Promise<void> {
        const vodId = this.selectedVodId();
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        if (!playlistId) return;

        const filePath = this.downloadsService.getDownloadedFilePath(
            vodId,
            playlistId,
            'vod'
        );

        if (filePath) {
            await this.downloadsService.playDownload(filePath);
        }
    }

    private addToRecentlyViewed(): void {
        this.xtreamStore.addRecentItem({
            xtreamId: this.selectedVodId(),
            contentType: 'movie',
            playlist: this.xtreamStore.currentPlaylist,
            backdropUrl: this.selectedVodInfo()?.backdrop_path?.[0],
        });
    }

    private initializeVodDetails(playlistId: string, vodId: number): void {
        const categoryId = this.selectedCategoryId();
        this.xtreamStore.setSelectedItem(null);
        this.xtreamStore.fetchVodDetailsWithMetadata({
            vodId: String(vodId),
            categoryId: Number(categoryId),
        });
        this.xtreamStore.checkFavoriteStatus(vodId, playlistId, 'movie');
        void this.loadVodPlaybackPosition(playlistId, vodId);
    }

    private initializeVodDetailsIfNeeded(
        playlistId: string | undefined,
        vodId: number
    ): void {
        if (!playlistId || !Number.isFinite(vodId) || vodId <= 0) {
            return;
        }

        const initKey = `${playlistId}:${vodId}`;
        if (this.detailsInitKey() === initKey) {
            return;
        }

        this.initializeVodDetails(playlistId, vodId);
        this.detailsInitKey.set(initKey);
    }

    private startPlayback(playback: ResolvedPortalPlayback): void {
        this.lastSaveTime = 0;
        if (this.portalPlayer.isEmbeddedPlayer()) {
            this.inlinePlayback.set(playback);
            return;
        }

        this.closeInlinePlayer();
        void this.portalPlayer.openResolvedPlayback(playback, true);
    }

    private async loadVodPlaybackPosition(
        playlistId: string,
        vodId: number
    ): Promise<void> {
        const position = await this.playbackPositions.getPlaybackPosition(
            playlistId,
            vodId,
            'vod'
        );
        this.vodPlaybackPosition.set(position);
    }

    private async loadTmdbSimilarMovies({
        key,
        vodId,
        currentDetails,
        currentCatalogItem,
        candidates,
        language,
    }: {
        key: string;
        vodId: number;
        currentDetails: XtreamVodDetails & Partial<XtreamVodStream>;
        currentCatalogItem:
            | (Partial<XtreamVodStream> & {
                  id?: string | number;
                  poster_url?: string;
                  title?: string;
                  xtream_id?: string | number;
              })
            | null;
        candidates: XtreamVodStream[];
        language: string;
    }): Promise<void> {
        try {
            const recommendations =
                await this.tmdbMetadata.getSimilarMoviesForCatalog({
                    currentVodId: vodId,
                    currentDetails,
                    currentCatalogItem,
                    candidates,
                    language,
                });

            if (this.tmdbSimilarMoviesKey() === key) {
                this.tmdbSimilarMovies.set(recommendations);
            }
        } catch (error) {
            this.logger.warn(
                'TMDb enrichment failed; using local VOD metadata',
                {
                    error,
                }
            );
            if (this.tmdbSimilarMoviesKey() === key) {
                this.tmdbSimilarMovies.set([]);
            }
        }
    }
}

function hashMetadataCredential(value: string): string {
    let hash = 0;
    for (let index = 0; index < value.length; index++) {
        hash = (hash * 31 + value.charCodeAt(index)) | 0;
    }

    return `${value.length}:${hash.toString(36)}`;
}

function splitPersonNames(value: string | null | undefined): string[] {
    return (value ?? '')
        .split(/[,;/|]+/)
        .map((name) => name.trim())
        .filter(Boolean);
}
