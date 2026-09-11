import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { Location } from '@angular/common';
import {
    PORTAL_EXTERNAL_PLAYBACK,
    PORTAL_PLAYBACK_POSITIONS,
    PORTAL_PLAYER,
} from '@iptvnator/portal/shared/util';
import {
    TmdbMovieMetadataService,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import {
    XtreamCategory,
    XtreamVodDetails,
    XtreamVodStream,
} from '@iptvnator/shared/interfaces';
import { DownloadsService, SettingsStore } from '@iptvnator/services';
import { MatSnackBar } from '@angular/material/snack-bar';
import { VodDetailsRouteComponent } from './vod-details-route.component';

describe('VodDetailsRouteComponent', () => {
    let fixture: ComponentFixture<VodDetailsRouteComponent>;
    const selectedItem = signal<XtreamVodDetails | null>(null);
    const isLoadingDetails = signal(false);
    const detailsError = signal<string | null>(null);
    const isFavorite = signal(false);
    const currentPlaylist = signal<{
        id: string;
        userAgent?: string;
        referrer?: string;
        origin?: string;
    } | null>(null);
    const vodStreams = signal<Partial<XtreamVodStream>[]>([]);
    const vodCategories = signal<Partial<XtreamCategory>[]>([]);
    const fetchVodDetailsWithMetadata = jest.fn();
    const checkFavoriteStatus = jest.fn();
    const setSelectedItem = jest.fn();
    const toggleFavorite = jest.fn();
    const constructVodStreamUrl = jest
        .fn()
        .mockReturnValue('http://example.com/movie/650020.mp4');
    const addRecentItem = jest.fn();
    const backfillContentBackdrop = jest.fn().mockResolvedValue(undefined);
    const downloads = signal([]);
    const settings = signal({
        language: 'en',
        tmdbApiKey: '',
    });
    const getPlaybackPosition = jest.fn().mockResolvedValue(null);
    const getSimilarMoviesForCatalog = jest.fn().mockResolvedValue([]);
    const navigate = jest.fn().mockResolvedValue(true);

    beforeEach(async () => {
        selectedItem.set(null);
        isLoadingDetails.set(false);
        detailsError.set(null);
        isFavorite.set(false);
        currentPlaylist.set(null);
        vodStreams.set([]);
        vodCategories.set([]);
        settings.set({
            language: 'en',
            tmdbApiKey: '',
        });
        fetchVodDetailsWithMetadata.mockClear();
        checkFavoriteStatus.mockClear();
        setSelectedItem.mockClear();
        toggleFavorite.mockClear();
        constructVodStreamUrl.mockClear();
        addRecentItem.mockClear();
        backfillContentBackdrop.mockClear();
        getPlaybackPosition.mockClear();
        getSimilarMoviesForCatalog.mockClear();
        getSimilarMoviesForCatalog.mockResolvedValue([]);
        navigate.mockClear();

        await TestBed.configureTestingModule({
            imports: [VodDetailsRouteComponent],
            providers: [
                {
                    provide: ActivatedRoute,
                    useValue: {
                        snapshot: {
                            params: {
                                vodId: '650020',
                                categoryId: '235',
                            },
                        },
                    },
                },
                {
                    provide: Router,
                    useValue: {
                        navigate,
                    },
                },
                {
                    provide: TranslateService,
                    useValue: {
                        instant: (key: string) => key,
                        get: (key: string) => of(key),
                        stream: (key: string) => of(key),
                        onLangChange: of(null),
                        onTranslationChange: of(null),
                        onDefaultLangChange: of(null),
                        currentLang: 'en',
                        defaultLang: 'en',
                    },
                },
                {
                    provide: XtreamStore,
                    useValue: {
                        selectedItem,
                        isLoadingDetails,
                        detailsError,
                        isFavorite,
                        currentPlaylist,
                        vodStreams,
                        vodCategories,
                        fetchVodDetailsWithMetadata,
                        checkFavoriteStatus,
                        setSelectedItem,
                        toggleFavorite,
                        constructVodStreamUrl,
                        addRecentItem,
                        backfillContentBackdrop,
                    },
                },
                {
                    provide: SettingsStore,
                    useValue: {
                        theme: signal('dark'),
                        getSettings: () => settings(),
                    },
                },
                {
                    provide: TmdbMovieMetadataService,
                    useValue: {
                        getSimilarMoviesForCatalog,
                    },
                },
                {
                    provide: DownloadsService,
                    useValue: {
                        isAvailable: signal(false),
                        downloads,
                        isDownloaded: jest.fn().mockReturnValue(false),
                        isDownloading: jest.fn().mockReturnValue(false),
                        startDownload: jest.fn(),
                        getDownloadedFilePath: jest.fn(),
                        playDownload: jest.fn(),
                    },
                },
                {
                    provide: PORTAL_EXTERNAL_PLAYBACK,
                    useValue: {
                        activeSession: signal(null),
                        closeSession: jest.fn(),
                    },
                },
                {
                    provide: PORTAL_PLAYBACK_POSITIONS,
                    useValue: {
                        getPlaybackPosition,
                        savePlaybackPosition: jest
                            .fn()
                            .mockResolvedValue(undefined),
                    },
                },
                {
                    provide: PORTAL_PLAYER,
                    useValue: {
                        isEmbeddedPlayer: jest.fn().mockReturnValue(false),
                        openResolvedPlayback: jest.fn(),
                    },
                },
                {
                    provide: MatSnackBar,
                    useValue: {
                        open: jest.fn(),
                    },
                },
                {
                    provide: Location,
                    useValue: {
                        back: jest.fn(),
                    },
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(VodDetailsRouteComponent);
    });

    it('renders an informational fallback without playback controls when Xtream returns empty metadata', () => {
        selectedItem.set({
            info: [],
        } as XtreamVodDetails);
        vodStreams.set([
            {
                name: 'Die Kühe sind Los! (2004) DE',
                stream_id: 650020,
                stream_icon: 'https://example.com/cows.jpg',
                added: '1720000000',
                category_id: '235',
                container_extension: 'mp4',
                rating: 6.1,
                rating_imdb: '6.1',
            },
        ]);
        vodCategories.set([
            {
                category_id: '235',
                category_name: 'DE | DISNEY',
            },
        ]);

        fixture.detectChanges();

        const host = fixture.nativeElement as HTMLElement;
        expect(host.textContent).toContain('Die Kühe sind Los! (2004) DE');
        expect(
            host.querySelector('[data-testid="xtream-vod-fallback"]')
                ?.textContent
        ).toContain('XTREAM.DETAIL_FALLBACK.NOTE');
        expect(
            host.querySelector('[data-testid="xtream-vod-fallback-status"]')
                ?.textContent
        ).toContain('XTREAM.DETAIL_FALLBACK.STATUS');
        expect(host.querySelector('button.play-btn')).toBeNull();
        expect(host.querySelector('button.favorite-btn')).toBeNull();
        expect(host.querySelector('button.download-btn')).toBeNull();
    });

    it('keeps the full Xtream detail view when usable metadata exists', () => {
        selectedItem.set({
            info: {
                kinopoisk_url: '',
                tmdb_id: 228203,
                name: 'City of McFarland (2015)',
                o_name: 'City of McFarland (2015)',
                cover_big: 'https://example.com/poster-big.jpg',
                movie_image: 'https://example.com/poster.jpg',
                releasedate: '2015-02-20',
                episode_run_time: 129,
                youtube_trailer: '',
                director: 'Niki Caro',
                actors: 'Kevin Costner',
                cast: 'Kevin Costner',
                description: 'A populated description',
                plot: 'A populated plot',
                age: '',
                mpaa_rating: '',
                rating_count_kinopoisk: 0,
                country: 'English',
                genre: 'Drama',
                backdrop_path: ['https://example.com/backdrop.jpg'],
                duration_secs: 7744,
                duration: '02:09:04',
                video: ['H.264'],
                audio: ['AAC'],
                bitrate: 6251,
                rating: 7.455,
                rating_imdb: '7.455',
                rating_kinopoisk: '7.455',
            },
            movie_data: {
                stream_id: 678140,
                name: 'City of McFarland (2015) DE',
                added: '1750671180',
                category_id: '235',
                container_extension: 'mkv',
                custom_sid: null,
                direct_source: '',
            },
        });

        fixture.detectChanges();

        const host = fixture.nativeElement as HTMLElement;
        expect(host.textContent).toContain('City of McFarland (2015)');
        expect(
            host.querySelector('[data-testid="xtream-vod-fallback"]')
        ).toBeNull();
        expect(host.querySelector('button.play-btn')).not.toBeNull();
    });

    it('navigates to available actor movies from the detail metadata', () => {
        currentPlaylist.set({
            id: 'playlist-1',
        });
        selectedItem.set({
            info: {
                name: 'City of McFarland (2015)',
                movie_image: 'https://example.com/poster.jpg',
                releasedate: '2015-02-20',
                director: 'Niki Caro',
                actors: 'Kevin Costner, Maria Bello',
                cast: 'Kevin Costner, Maria Bello',
                description: 'A populated description',
                genre: 'Drama',
            },
            movie_data: {
                stream_id: 650020,
                name: 'City of McFarland (2015)',
                added: '1750671180',
                category_id: '235',
                container_extension: 'mkv',
                custom_sid: null,
                direct_source: '',
            },
        });

        fixture.detectChanges();

        const host = fixture.nativeElement as HTMLElement;
        const actorLink = host.querySelector<HTMLButtonElement>('.person-link');
        actorLink?.click();

        expect(navigate).toHaveBeenCalledWith([
            '/workspace',
            'xtreams',
            'playlist-1',
            'vod',
            'person',
            'actor',
            'Kevin Costner',
        ]);
    });

    it('renders similar movie recommendations and navigates to the selected movie', () => {
        currentPlaylist.set({
            id: 'playlist-1',
        });
        selectedItem.set({
            info: {
                name: 'City of McFarland (2015)',
                movie_image: 'https://example.com/poster.jpg',
                releasedate: '2015-02-20',
                director: 'Niki Caro',
                actors: 'Kevin Costner, Maria Bello',
                cast: 'Kevin Costner, Maria Bello',
                description: 'A populated description',
                genre: 'Drama, Sport',
                backdrop_path: ['https://example.com/backdrop.jpg'],
                duration: '02:09:04',
                rating_imdb: '7.4',
            },
            movie_data: {
                stream_id: 650020,
                name: 'City of McFarland (2015)',
                added: '1750671180',
                category_id: '235',
                container_extension: 'mkv',
                custom_sid: null,
                direct_source: '',
            },
        });
        vodStreams.set([
            {
                stream_id: 650020,
                name: 'City of McFarland (2015)',
                category_id: '235',
            },
            {
                stream_id: 650021,
                name: 'The Same Coach (2024)',
                stream_icon: 'https://example.com/same-coach.jpg',
                added: '1751000000',
                category_id: '235',
                info: {
                    director: 'Niki Caro',
                    releasedate: '2024-01-01',
                },
            },
        ] as Partial<XtreamVodStream>[]);

        fixture.detectChanges();

        const host = fixture.nativeElement as HTMLElement;
        const card = host.querySelector<HTMLButtonElement>(
            '[data-testid="similar-vod-card"]'
        );
        expect(host.textContent).toContain('XTREAM.SIMILAR_MOVIES');
        expect(host.textContent).toContain('The Same Coach (2024)');
        expect(host.textContent).toContain('XTREAM.SIMILAR_REASON_DIRECTOR');

        card?.click();

        expect(navigate).toHaveBeenCalledWith([
            '/workspace',
            'xtreams',
            'playlist-1',
            'vod',
            '235',
            650021,
        ]);
    });

    it('does not fill the recommendation rail with category-only Xtream matches', () => {
        currentPlaylist.set({
            id: 'playlist-1',
        });
        selectedItem.set({
            info: {
                name: 'Grizzly Night (2026)',
                genre: 'Horror, Thriller, Drama',
                description: 'A populated description',
            },
            movie_data: {
                stream_id: 650020,
                name: 'Grizzly Night (2026)',
                added: '1750671180',
                category_id: '235',
                container_extension: 'mkv',
                custom_sid: null,
                direct_source: '',
            },
        });
        vodStreams.set([
            {
                stream_id: 650020,
                name: 'Grizzly Night (2026)',
                category_id: '235',
            },
            {
                stream_id: 650021,
                name: 'FR - Random Same Category (2026)',
                added: '1751000000',
                category_id: '235',
            },
        ] as Partial<XtreamVodStream>[]);

        fixture.detectChanges();

        const host = fixture.nativeElement as HTMLElement;
        expect(
            host.querySelector('[data-testid="similar-vod-card"]')
        ).toBeNull();
        expect(host.textContent).not.toContain(
            'XTREAM.SIMILAR_REASON_CATEGORY'
        );
    });

    it('renders at most nine TMDb-enriched recommendations in the grid', async () => {
        settings.set({
            language: 'en',
            tmdbApiKey: 'test-tmdb-key',
        });
        currentPlaylist.set({
            id: 'playlist-1',
        });
        selectedItem.set({
            info: {
                name: 'City of McFarland (2015)',
                tmdb_id: 228203,
                releasedate: '2015-02-20',
                director: 'Niki Caro',
                actors: 'Kevin Costner',
                genre: 'Drama',
                description: 'A populated description',
            },
            movie_data: {
                stream_id: 650020,
                name: 'City of McFarland (2015)',
                added: '1750671180',
                category_id: '235',
                container_extension: 'mkv',
                custom_sid: null,
                direct_source: '',
            },
        });
        vodStreams.set([
            {
                stream_id: 650020,
                name: 'City of McFarland (2015)',
                category_id: '235',
            },
            {
                stream_id: 650022,
                name: 'Online Match (2024)',
                category_id: '236',
            },
        ] as Partial<XtreamVodStream>[]);
        getSimilarMoviesForCatalog.mockResolvedValue([
            {
                streamId: 650022,
                categoryId: '236',
                title: 'Online Match (2024)',
                posterUrl: 'https://image.tmdb.org/t/p/w342/poster.jpg',
                rating: '7.8',
                year: '2024',
                addedTimestamp: 1752000000000,
                reasons: ['actor'],
                reasonNames: {
                    actor: ['Kevin Costner'],
                },
                score: 5,
            },
            ...Array.from({ length: 9 }, (_, index) => ({
                streamId: 650023 + index,
                categoryId: '236',
                title: `Related movie ${index + 2}`,
                posterUrl: `https://image.tmdb.org/t/p/w342/poster-${index}.jpg`,
                rating: '7.5',
                year: '2024',
                addedTimestamp: 1752000000000 - index,
                reasons: ['actor'],
                reasonNames: {
                    actor: ['Kevin Costner'],
                },
                score: 4,
            })),
        ]);

        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        const host = fixture.nativeElement as HTMLElement;
        expect(getSimilarMoviesForCatalog).toHaveBeenCalledWith(
            expect.objectContaining({
                currentVodId: 650020,
                language: 'en',
                limit: 9,
            })
        );
        expect(
            host.querySelector('[data-testid="similar-vod-grid"]')
        ).not.toBeNull();
        expect(
            host.querySelectorAll('[data-testid="similar-vod-card"]')
        ).toHaveLength(9);
        expect(host.textContent).toContain('Online Match (2024)');
        expect(host.textContent).toContain('XTREAM.SIMILAR_REASON_ACTOR_NAMED');

        host.querySelector<HTMLButtonElement>(
            '.similar-movie__reason--link'
        )?.click();

        expect(navigate).toHaveBeenCalledWith([
            '/workspace',
            'xtreams',
            'playlist-1',
            'vod',
            'person',
            'actor',
            'Kevin Costner',
        ]);
    });
});
