import { Location } from '@angular/common';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { NEVER, of } from 'rxjs';
import { SettingsStore } from '@iptvnator/services';
import {
    TmdbMovieMetadataService,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import { XtreamVodStream } from '@iptvnator/shared/interfaces';
import { PersonVodResultsComponent } from './person-vod-results.component';

describe('PersonVodResultsComponent', () => {
    let fixture: ComponentFixture<PersonVodResultsComponent>;
    const currentPlaylist = signal<{ id: string } | null>({
        id: 'playlist-1',
    });
    const vodStreams = signal<Partial<XtreamVodStream>[]>([]);
    const isLoadingContent = signal(false);
    const getAvailableMoviesForEntity = jest.fn().mockResolvedValue([]);
    const navigate = jest.fn().mockResolvedValue(true);
    const back = jest.fn();

    beforeEach(async () => {
        vodStreams.set([]);
        isLoadingContent.set(false);
        getAvailableMoviesForEntity.mockClear();
        getAvailableMoviesForEntity.mockResolvedValue([]);
        navigate.mockClear();
        back.mockClear();

        await TestBed.configureTestingModule({
            imports: [PersonVodResultsComponent],
            providers: [
                {
                    provide: ActivatedRoute,
                    useValue: {
                        snapshot: {
                            params: {
                                role: 'actor',
                                name: 'Kevin%20Costner',
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
                    provide: Location,
                    useValue: {
                        back,
                    },
                },
                {
                    provide: XtreamStore,
                    useValue: {
                        currentPlaylist,
                        vodStreams,
                        isLoadingContent,
                    },
                },
                {
                    provide: SettingsStore,
                    useValue: {
                        getSettings: () => ({
                            language: 'en',
                            tmdbApiKey: 'test-tmdb-key',
                        }),
                    },
                },
                {
                    provide: TmdbMovieMetadataService,
                    useValue: {
                        getAvailableMoviesForEntity,
                    },
                },
                {
                    provide: TranslateService,
                    useValue: {
                        instant: (key: string) => key,
                        get: (key: string) => of(key),
                        stream: (key: string) => of(key),
                        onLangChange: NEVER,
                        onTranslationChange: NEVER,
                        onDefaultLangChange: NEVER,
                        currentLang: 'en',
                        defaultLang: 'en',
                    },
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(PersonVodResultsComponent);
    });

    it('loads available movies for the clicked actor and opens the selected movie', async () => {
        vodStreams.set([
            {
                stream_id: 650020,
                name: 'Online Match (2024)',
                category_id: '236',
            },
        ]);
        getAvailableMoviesForEntity.mockResolvedValue([
            {
                streamId: 650020,
                categoryId: '236',
                title: 'Online Match (2024)',
                posterUrl: 'https://example.com/poster.jpg',
                rating: '8.1',
                year: '2024',
                addedTimestamp: 1752000000000,
                reasons: ['actor'],
                reasonNames: {
                    actor: ['Kevin Costner'],
                },
                score: 5,
            },
        ]);

        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        const host = fixture.nativeElement as HTMLElement;
        expect(getAvailableMoviesForEntity).toHaveBeenCalledWith(
            expect.objectContaining({
                role: 'actor',
                name: 'Kevin Costner',
                language: 'en',
            })
        );
        expect(host.textContent).toContain('Kevin Costner');
        expect(host.textContent).toContain('Online Match (2024)');

        host.querySelector<HTMLElement>('mat-card')?.click();

        expect(navigate).toHaveBeenCalledWith([
            '/workspace',
            'xtreams',
            'playlist-1',
            'vod',
            '236',
            650020,
        ]);
    });

    it('falls back to local actor metadata when online metadata has no match', async () => {
        vodStreams.set([
            {
                stream_id: 650021,
                name: 'Local Actor Match (2025)',
                category_id: '237',
                added: '1753000000',
                info: {
                    name: 'Local Actor Match (2025)',
                    actors: 'Kevin Costner, Maria Bello',
                    movie_image: 'https://example.com/local.jpg',
                    rating_imdb: '7.4',
                },
            },
        ] as Partial<XtreamVodStream>[]);
        getAvailableMoviesForEntity.mockResolvedValue([]);

        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        const host = fixture.nativeElement as HTMLElement;
        expect(host.textContent).toContain('Local Actor Match (2025)');
    });
});
