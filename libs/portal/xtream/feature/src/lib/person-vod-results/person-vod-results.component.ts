import { Location } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    inject,
    signal,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { SettingsStore } from '@iptvnator/services';
import { GridListComponent } from '@iptvnator/portal/shared/ui';
import { createLogger, routeParamSignal } from '@iptvnator/portal/shared/util';
import {
    TmdbCatalogEntityRole,
    TmdbMovieMetadataService,
    TmdbSimilarVodRecommendation,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import {
    XtreamVodDetails,
    XtreamVodStream,
    getXtreamVodInfo,
} from '@iptvnator/shared/interfaces';

type PersonVodCatalogItem = Partial<XtreamVodStream> &
    Partial<XtreamVodDetails> & {
        id?: string | number;
        poster_url?: string;
        title?: string;
        xtream_id?: string | number;
        added_at?: string | number;
        rating?: string | number;
        rating_imdb?: string | number;
    };

interface PersonVodGridItem {
    id?: string | number;
    stream_id?: string | number;
    xtream_id?: string | number;
    category_id?: string | number;
    poster_url?: string;
    title?: string;
    rating?: string | number;
    rating_imdb?: string | number;
    added?: string | number;
    [key: string]: unknown;
}

@Component({
    selector: 'app-person-vod-results',
    templateUrl: './person-vod-results.component.html',
    styleUrls: ['./person-vod-results.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [GridListComponent, MatIcon, TranslateModule],
})
export class PersonVodResultsComponent {
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly location = inject(Location);
    private readonly xtreamStore = inject(XtreamStore);
    private readonly tmdbMetadata = inject(TmdbMovieMetadataService);
    private readonly settingsStore = inject(SettingsStore);
    private readonly logger = createLogger('PersonVodResults');
    private readonly loadKey = signal<string | null>(null);

    readonly roleParam = routeParamSignal<string>(
        this.route,
        'role',
        (value) => value ?? ''
    );
    readonly personName = routeParamSignal<string>(
        this.route,
        'name',
        decodeRouteSegment
    );
    readonly role = computed(() => toCatalogEntityRole(this.roleParam()));
    readonly items = signal<PersonVodGridItem[]>([]);
    readonly isLoading = signal(false);
    readonly error = signal<string | null>(null);

    constructor() {
        effect(() => {
            const role = this.role();
            const name = this.personName();
            const playlistId = this.xtreamStore.currentPlaylist()?.id ?? '';
            const candidates =
                this.xtreamStore.vodStreams() as PersonVodCatalogItem[];
            const isContentLoading = this.xtreamStore.isLoadingContent();
            const settings = this.settingsStore.getSettings();
            const credential = settings.tmdbApiKey?.trim() ?? '';
            const key = [
                playlistId,
                role ?? '',
                name,
                settings.language,
                hashMetadataCredential(credential),
                candidates.length,
            ].join(':');

            if (!role || !name) {
                this.loadKey.set(null);
                this.items.set([]);
                this.isLoading.set(false);
                this.error.set(null);
                return;
            }

            if (candidates.length === 0) {
                this.loadKey.set(null);
                this.items.set([]);
                this.isLoading.set(isContentLoading);
                this.error.set(null);
                return;
            }

            if (this.loadKey() === key) {
                return;
            }

            this.loadKey.set(key);
            void this.loadAvailableMovies({
                key,
                role,
                name,
                candidates,
                language: settings.language,
            });
        });
    }

    getRoleLabelKey(role: TmdbCatalogEntityRole | null): string {
        if (!role) {
            return 'XTREAM.PERSON_ROLE_UNKNOWN';
        }

        return `XTREAM.PERSON_ROLE_${role.toUpperCase()}`;
    }

    goBack(): void {
        this.location.back();
    }

    openMovie(item: PersonVodGridItem): void {
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        const streamId = Number(item.xtream_id ?? item.stream_id ?? item.id);
        const categoryId = item.category_id;

        if (!playlistId || !Number.isFinite(streamId) || !categoryId) {
            return;
        }

        void this.router.navigate([
            '/workspace',
            'xtreams',
            playlistId,
            'vod',
            String(categoryId),
            streamId,
        ]);
    }

    private async loadAvailableMovies({
        key,
        role,
        name,
        candidates,
        language,
    }: {
        key: string;
        role: TmdbCatalogEntityRole;
        name: string;
        candidates: PersonVodCatalogItem[];
        language: string;
    }): Promise<void> {
        this.isLoading.set(true);
        this.error.set(null);

        try {
            const recommendations =
                await this.tmdbMetadata.getAvailableMoviesForEntity({
                    role,
                    name,
                    candidates,
                    language,
                });
            const results =
                recommendations.length > 0
                    ? recommendations.map(toGridItemFromRecommendation)
                    : buildLocalMatches(role, name, candidates);

            if (this.loadKey() === key) {
                this.items.set(results);
            }
        } catch (error) {
            this.logger.warn(
                'TMDb person lookup failed; using local metadata',
                {
                    error,
                    role,
                    name,
                }
            );
            const fallbackResults = buildLocalMatches(role, name, candidates);
            if (this.loadKey() === key) {
                this.items.set(fallbackResults);
                this.error.set(
                    fallbackResults.length > 0
                        ? null
                        : 'XTREAM.PERSON_RESULTS_ERROR'
                );
            }
        } finally {
            if (this.loadKey() === key) {
                this.isLoading.set(false);
            }
        }
    }
}

function toCatalogEntityRole(value: string): TmdbCatalogEntityRole | null {
    switch (value) {
        case 'actor':
        case 'director':
        case 'producer':
        case 'writer':
        case 'company':
        case 'genre':
            return value;
        default:
            return null;
    }
}

function toGridItemFromRecommendation(
    item: TmdbSimilarVodRecommendation
): PersonVodGridItem {
    return {
        id: item.streamId,
        stream_id: item.streamId,
        xtream_id: item.streamId,
        category_id: item.categoryId,
        poster_url: item.posterUrl,
        title: item.title,
        rating: item.rating,
        added: item.addedTimestamp
            ? String(Math.floor(item.addedTimestamp / 1000))
            : undefined,
    };
}

function buildLocalMatches(
    role: TmdbCatalogEntityRole,
    name: string,
    candidates: PersonVodCatalogItem[]
): PersonVodGridItem[] {
    if (role !== 'actor' && role !== 'director' && role !== 'genre') {
        return [];
    }

    const normalizedName = normalizeEntityName(name);
    if (!normalizedName) {
        return [];
    }

    return candidates
        .filter((candidate) => {
            const info = getXtreamVodInfo(candidate);
            if (!info) {
                return false;
            }

            const values =
                role === 'actor'
                    ? splitEntityNames(info.actors || info.cast)
                    : role === 'director'
                      ? splitEntityNames(info.director)
                      : splitEntityNames(info.genre);

            return values.some(
                (value) => normalizeEntityName(value) === normalizedName
            );
        })
        .sort((a, b) => getAddedTimestamp(b) - getAddedTimestamp(a))
        .slice(0, 120)
        .map(toGridItemFromCatalog);
}

function toGridItemFromCatalog(item: PersonVodCatalogItem): PersonVodGridItem {
    const info = getXtreamVodInfo(item);
    const streamId = Number(
        item.xtream_id ??
            item.stream_id ??
            item.id ??
            item.movie_data?.stream_id
    );

    return {
        id: Number.isFinite(streamId) ? streamId : item.id,
        stream_id: Number.isFinite(streamId) ? streamId : item.stream_id,
        xtream_id: Number.isFinite(streamId) ? streamId : item.xtream_id,
        category_id: item.category_id ?? item.movie_data?.category_id,
        poster_url:
            info?.movie_image ??
            info?.cover_big ??
            item.stream_icon ??
            item.poster_url,
        title:
            info?.name ??
            item.movie_data?.name ??
            item.name ??
            item.title ??
            '',
        rating:
            info?.rating_imdb ??
            info?.rating ??
            item.rating_imdb ??
            item.rating,
        added: item.added_at ?? item.added,
    };
}

function getAddedTimestamp(item: PersonVodCatalogItem): number {
    const value = Number(item.added_at ?? item.added ?? 0);
    if (!Number.isFinite(value) || value <= 0) {
        return 0;
    }

    return value < 100000000000 ? value * 1000 : value;
}

function splitEntityNames(value: string | undefined | null): string[] {
    return (value ?? '')
        .split(/[,;/|]+/)
        .map((name) => name.trim())
        .filter(Boolean);
}

function normalizeEntityName(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/gi, ' ')
        .trim()
        .toLowerCase();
}

function decodeRouteSegment(value: string | null): string {
    const raw = value ?? '';
    try {
        return decodeURIComponent(raw).trim();
    } catch {
        return raw.trim();
    }
}

function hashMetadataCredential(value: string): string {
    let hash = 0;
    for (let index = 0; index < value.length; index++) {
        hash = (hash * 31 + value.charCodeAt(index)) | 0;
    }

    return `${value.length}:${hash.toString(36)}`;
}
