import { TestBed } from '@angular/core/testing';
import { SettingsStore } from '@iptvnator/services';
import {
    XtreamVodDetails,
    XtreamVodStream,
} from '@iptvnator/shared/interfaces';
import { TmdbMovieMetadataService } from './tmdb-movie-metadata.service';

describe('TmdbMovieMetadataService', () => {
    let service: TmdbMovieMetadataService;
    let fetchMock: jest.MockedFunction<typeof fetch>;
    const originalFetch = globalThis.fetch;
    const settingsStore = {
        getSettings: jest.fn(() => ({
            language: 'en',
            tmdbApiKey: 'test-tmdb-key',
        })),
    };

    beforeEach(() => {
        localStorage.clear();
        fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
        globalThis.fetch = fetchMock;
        settingsStore.getSettings.mockReturnValue({
            language: 'en',
            tmdbApiKey: 'test-tmdb-key',
        });

        TestBed.configureTestingModule({
            providers: [
                TmdbMovieMetadataService,
                {
                    provide: SettingsStore,
                    useValue: settingsStore,
                },
            ],
        });
        service = TestBed.inject(TmdbMovieMetadataService);
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('maps TMDb discover results back to movies from the local VOD catalog', async () => {
        fetchMock.mockImplementation((input) => {
            const url = String(input);
            const searchParams = new URL(url).searchParams;
            if (url.includes('/movie/123')) {
                return jsonResponse({
                    id: 123,
                    title: 'Current Movie',
                    release_date: '2020-01-01',
                    genres: [{ id: 18, name: 'Drama' }],
                    production_companies: [{ id: 5, name: 'Known Studio' }],
                    credits: {
                        cast: [{ id: 1, name: 'Known Actor', order: 0 }],
                        crew: [
                            { id: 2, name: 'Known Director', job: 'Director' },
                            { id: 3, name: 'Known Producer', job: 'Producer' },
                            { id: 4, name: 'Known Writer', job: 'Screenplay' },
                        ],
                    },
                });
            }

            if (searchParams.get('with_cast') === '1') {
                return jsonResponse({
                    results: [
                        {
                            id: 456,
                            title: 'Online Match',
                            release_date: '2024-02-01',
                            poster_path: '/poster.jpg',
                            vote_average: 7.8,
                        },
                    ],
                });
            }

            if (searchParams.get('with_crew') === '2') {
                return jsonResponse({
                    results: [
                        {
                            id: 457,
                            title: 'Director Match',
                            release_date: '2024-03-01',
                            vote_average: 7.1,
                        },
                    ],
                });
            }

            if (searchParams.get('with_crew') === '3') {
                return jsonResponse({
                    results: [
                        {
                            id: 458,
                            title: 'Producer Match',
                            release_date: '2024-04-01',
                            vote_average: 7.2,
                        },
                    ],
                });
            }

            if (searchParams.get('with_crew') === '4') {
                return jsonResponse({
                    results: [
                        {
                            id: 459,
                            title: 'Writer Match',
                            release_date: '2024-05-01',
                            vote_average: 7.3,
                        },
                    ],
                });
            }

            if (searchParams.get('with_companies') === '5') {
                return jsonResponse({
                    results: [
                        {
                            id: 460,
                            title: 'Studio Match',
                            release_date: '2024-06-01',
                            vote_average: 7.4,
                        },
                    ],
                });
            }

            return jsonResponse({ results: [] });
        });

        const recommendations = await service.getSimilarMoviesForCatalog({
            currentVodId: 10,
            currentDetails: {
                info: {
                    tmdb_id: 123,
                    name: 'Current Movie',
                },
                movie_data: {
                    stream_id: 10,
                    name: 'Current Movie',
                    added: '1700000000',
                    category_id: '42',
                    container_extension: 'mkv',
                    custom_sid: null,
                    direct_source: '',
                },
            } as XtreamVodDetails,
            currentCatalogItem: null,
            candidates: [
                {
                    stream_id: 10,
                    name: 'Current Movie',
                    category_id: '42',
                },
                {
                    stream_id: 11,
                    name: 'Online Match (2024)',
                    stream_icon: 'https://example.com/local-poster.jpg',
                    added: '1750000000',
                    category_id: '43',
                },
                {
                    stream_id: 12,
                    name: 'Director Match (2024)',
                    added: '1751000000',
                    category_id: '43',
                },
                {
                    stream_id: 13,
                    name: 'Producer Match (2024)',
                    added: '1752000000',
                    category_id: '43',
                },
                {
                    stream_id: 14,
                    name: 'Writer Match (2024)',
                    added: '1753000000',
                    category_id: '43',
                },
                {
                    stream_id: 15,
                    name: 'Studio Match (2024)',
                    added: '1754000000',
                    category_id: '43',
                },
            ] as XtreamVodStream[],
            language: 'en',
        });

        expect(recommendations).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    streamId: 11,
                    categoryId: '43',
                    title: 'Online Match (2024)',
                    posterUrl: 'https://example.com/local-poster.jpg',
                    rating: '7.8',
                    year: '2024',
                    reasons: ['actor'],
                    reasonNames: {
                        actor: ['Known Actor'],
                    },
                }),
                expect.objectContaining({
                    streamId: 12,
                    reasons: ['director'],
                    reasonNames: {
                        director: ['Known Director'],
                    },
                }),
                expect.objectContaining({
                    streamId: 13,
                    reasons: ['producer'],
                    reasonNames: {
                        producer: ['Known Producer'],
                    },
                }),
                expect.objectContaining({
                    streamId: 14,
                    reasons: ['writer'],
                    reasonNames: {
                        writer: ['Known Writer'],
                    },
                }),
                expect.objectContaining({
                    streamId: 15,
                    reasons: ['company'],
                    reasonNames: {
                        company: ['Known Studio'],
                    },
                }),
            ])
        );
        expect(fetchMock).toHaveBeenCalledWith(
            expect.objectContaining({
                href: expect.stringContaining('api_key=test-tmdb-key'),
            }),
            expect.any(Object)
        );
        const urls = fetchMock.mock.calls.map(([input]) => String(input));
        expect(urls.some((url) => url.includes('with_crew=2'))).toBe(true);
        expect(urls.some((url) => url.includes('with_crew=3'))).toBe(true);
        expect(urls.some((url) => url.includes('with_crew=4'))).toBe(true);
        expect(urls.some((url) => url.includes('with_companies=5'))).toBe(true);
    });

    it('returns no recommendations when no TMDb credential is configured', async () => {
        settingsStore.getSettings.mockReturnValue({
            language: 'en',
            tmdbApiKey: '',
        });

        await expect(
            service.getSimilarMoviesForCatalog({
                currentVodId: 10,
                currentDetails: null,
                currentCatalogItem: null,
                candidates: [],
                language: 'en',
            })
        ).resolves.toEqual([]);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps a clicked actor to available movies from the local VOD catalog', async () => {
        fetchMock.mockImplementation((input) => {
            const url = String(input);
            const searchParams = new URL(url).searchParams;
            if (url.includes('/search/person')) {
                return jsonResponse({
                    results: [{ id: 42, name: 'Kevin Costner' }],
                });
            }

            if (searchParams.get('with_cast') === '42') {
                return jsonResponse({
                    results: [
                        {
                            id: 456,
                            title: 'Online Match',
                            release_date: '2024-02-01',
                            poster_path: '/poster.jpg',
                            vote_average: 8.1,
                        },
                    ],
                });
            }

            return jsonResponse({ results: [] });
        });

        const recommendations = await service.getAvailableMoviesForEntity({
            role: 'actor',
            name: 'Kevin Costner',
            candidates: [
                {
                    stream_id: 44,
                    name: 'Online Match (2024)',
                    category_id: '99',
                    added: '1750000000',
                },
            ] as XtreamVodStream[],
            language: 'en',
        });

        expect(recommendations).toEqual([
            expect.objectContaining({
                streamId: 44,
                categoryId: '99',
                title: 'Online Match (2024)',
                rating: '8.1',
                year: '2024',
                reasons: ['actor'],
                reasonNames: {
                    actor: ['Kevin Costner'],
                },
            }),
        ]);
        const urls = fetchMock.mock.calls.map(([input]) => String(input));
        expect(urls.some((url) => url.includes('/search/person'))).toBe(true);
        expect(urls.some((url) => url.includes('with_cast=42'))).toBe(true);
    });
});

function jsonResponse(value: unknown): Promise<Response> {
    return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(value),
    } as Response);
}
