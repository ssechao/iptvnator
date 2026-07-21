import { Injectable, inject } from '@angular/core';
import { SettingsStore } from '@iptvnator/services';
import {
    XtreamVodDetails,
    XtreamVodStream,
    getXtreamVodInfo,
} from '@iptvnator/shared/interfaces';

export type TmdbSimilarVodReason =
    | 'actor'
    | 'director'
    | 'producer'
    | 'writer'
    | 'company'
    | 'genre'
    | 'category';

export type TmdbCatalogEntityRole = Exclude<TmdbSimilarVodReason, 'category'>;

export interface TmdbSimilarVodRecommendation {
    streamId: number;
    categoryId: string;
    title: string;
    posterUrl?: string;
    rating?: string;
    year?: string;
    addedTimestamp: number;
    reasons: TmdbSimilarVodReason[];
    reasonNames?: TmdbSimilarVodReasonNames;
    score: number;
}

export type TmdbSimilarVodReasonNames = Partial<
    Record<TmdbSimilarVodReason, string[]>
>;

type TmdbMovieResult = {
    id: number;
    title?: string;
    original_title?: string;
    release_date?: string;
    poster_path?: string;
    vote_average?: number;
};

type TmdbMovieDetails = TmdbMovieResult & {
    genres?: Array<{ id: number; name: string }>;
    production_companies?: Array<{ id: number; name: string }>;
    credits?: {
        cast?: Array<{ id: number; name: string; order?: number }>;
        crew?: Array<{ id: number; name: string; job?: string }>;
    };
};

type TmdbMovieSearchResponse = {
    results?: TmdbMovieResult[];
};

type TmdbPersonSearchResponse = {
    results?: Array<{ id: number; name: string }>;
};

type TmdbCompanySearchResponse = {
    results?: Array<{ id: number; name: string }>;
};

type TmdbGenreListResponse = {
    genres?: Array<{ id: number; name: string }>;
};

type TmdbEnrichedMovie = {
    id: number;
    title: string;
    originalTitle?: string;
    year?: string;
    posterUrl?: string;
    rating?: string;
    genreNames: string[];
    genreIds: number[];
    actorNames: string[];
    actorIds: number[];
    directorNames: string[];
    directorIds: number[];
    producerNames: string[];
    producerIds: number[];
    writerNames: string[];
    writerIds: number[];
    companyNames: string[];
    companyIds: number[];
};

type TmdbCatalogCandidate = Partial<XtreamVodStream> &
    Partial<XtreamVodDetails> & {
        id?: string | number;
        poster_url?: string;
        title?: string;
    };

type TmdbCacheEntry<T> = {
    expiresAt: number;
    value: T;
};

type TmdbDiscoverReason =
    | 'actor'
    | 'director'
    | 'producer'
    | 'writer'
    | 'company'
    | 'genre';

interface TmdbRecommendationLookup {
    movie: TmdbMovieResult;
    reasons: Set<TmdbDiscoverReason>;
    reasonNames: Map<TmdbDiscoverReason, Set<string>>;
}

type TmdbRecommendationCacheItem = {
    movie: TmdbMovieResult;
    reasons: TmdbDiscoverReason[];
    reasonNames?: Partial<Record<TmdbDiscoverReason, string[]>>;
};

@Injectable({ providedIn: 'root' })
export class TmdbMovieMetadataService {
    private readonly settingsStore = inject(SettingsStore);
    private readonly baseUrl = 'https://api.themoviedb.org/3';
    private readonly imageBaseUrl = 'https://image.tmdb.org/t/p/w342';
    private readonly searchCacheTtlMs = 30 * 24 * 60 * 60 * 1000;
    private readonly detailsCacheTtlMs = 30 * 24 * 60 * 60 * 1000;
    private readonly discoverCacheTtlMs = 7 * 24 * 60 * 60 * 1000;

    async getSimilarMoviesForCatalog({
        currentVodId,
        currentDetails,
        currentCatalogItem,
        candidates,
        language,
        limit = 12,
    }: {
        currentVodId: number;
        currentDetails: (XtreamVodDetails & TmdbCatalogCandidate) | null;
        currentCatalogItem?: TmdbCatalogCandidate | null;
        candidates: TmdbCatalogCandidate[];
        language: string;
        limit?: number;
    }): Promise<TmdbSimilarVodRecommendation[]> {
        const credential = this.getCredential();
        if (!credential || !currentDetails) {
            return [];
        }

        const currentMovie = await this.resolveCurrentMovie(
            currentDetails,
            currentCatalogItem,
            language,
            credential
        );
        if (!currentMovie) {
            return [];
        }

        const recommendations = await this.fetchTmdbRecommendations(
            currentMovie,
            language,
            credential
        );

        return this.mapLookupsToCatalog(recommendations, candidates, {
            excludedStreamId: Number(currentVodId),
            limit,
        });
    }

    async getAvailableMoviesForEntity({
        role,
        name,
        candidates,
        language,
        limit = 120,
    }: {
        role: TmdbCatalogEntityRole;
        name: string;
        candidates: TmdbCatalogCandidate[];
        language: string;
        limit?: number;
    }): Promise<TmdbSimilarVodRecommendation[]> {
        const credential = this.getCredential();
        const entityName = name.trim();
        if (!credential || !entityName || candidates.length === 0) {
            return [];
        }

        const entity = await this.resolveEntity(
            role,
            entityName,
            language,
            credential
        );
        if (!entity) {
            return [];
        }

        const lookup = await this.discoverMovies(
            buildEntityDiscoverParams(role, entity.id),
            role,
            entity.name,
            language,
            credential
        );
        const lookups = new Map<number, TmdbRecommendationLookup>();
        for (const movie of lookup.results) {
            const reasonNames = new Map<TmdbDiscoverReason, Set<string>>();
            addReasonName(reasonNames, role, entity.name);
            lookups.set(movie.id, {
                movie,
                reasons: new Set([role]),
                reasonNames,
            });
        }

        return this.mapLookupsToCatalog(lookups, candidates, { limit });
    }

    private getCredential(): string {
        return this.settingsStore.getSettings().tmdbApiKey?.trim() ?? '';
    }

    private async resolveCurrentMovie(
        currentDetails: XtreamVodDetails & TmdbCatalogCandidate,
        currentCatalogItem: TmdbCatalogCandidate | null | undefined,
        language: string,
        credential: string
    ): Promise<TmdbEnrichedMovie | null> {
        const info = getXtreamVodInfo(currentDetails);
        const tmdbId = Number(info?.tmdb_id);
        if (Number.isFinite(tmdbId) && tmdbId > 0) {
            return this.fetchMovieDetails(tmdbId, language, credential);
        }

        const title =
            getCatalogTitle(currentCatalogItem) ||
            currentDetails.movie_data?.name ||
            getCatalogTitle(currentDetails);
        if (!title) {
            return null;
        }

        const year =
            extractYear(info?.releasedate) ??
            extractYear(currentDetails.movie_data?.name) ??
            extractYear(title);
        const searchResult = await this.searchMovie(
            normalizeMovieTitle(title),
            year,
            language,
            credential
        );

        return searchResult
            ? this.fetchMovieDetails(searchResult.id, language, credential)
            : null;
    }

    private async searchMovie(
        title: string,
        year: string | undefined,
        language: string,
        credential: string
    ): Promise<TmdbMovieResult | null> {
        const key = `search:${language}:${title}:${year ?? ''}`;
        const cached = this.getCached<TmdbMovieResult | null>(key);
        if (cached !== undefined) {
            return cached;
        }

        const params: Record<string, string> = {
            query: title,
            language: toTmdbLanguage(language),
            include_adult: 'false',
        };
        if (year) {
            params.year = year;
        }

        const response = await this.request<TmdbMovieSearchResponse>(
            '/search/movie',
            params,
            credential
        );
        const result = response.results?.[0] ?? null;
        this.setCached(key, result);
        return result;
    }

    private async fetchMovieDetails(
        movieId: number,
        language: string,
        credential: string
    ): Promise<TmdbEnrichedMovie | null> {
        const key = `details:v2:${language}:${movieId}`;
        const cached = this.getCached<TmdbEnrichedMovie | null>(key);
        if (cached !== undefined) {
            return cached;
        }

        const details = await this.request<TmdbMovieDetails>(
            `/movie/${movieId}`,
            {
                append_to_response: 'credits',
                language: toTmdbLanguage(language),
            },
            credential
        );
        const enriched = toEnrichedMovie(details, this.imageBaseUrl);
        this.setCached(key, enriched);
        return enriched;
    }

    private async fetchTmdbRecommendations(
        movie: TmdbEnrichedMovie,
        language: string,
        credential: string
    ): Promise<Map<number, TmdbRecommendationLookup>> {
        const key = `discover:v3:${language}:${movie.id}`;
        const cached = this.getCached<TmdbRecommendationCacheItem[]>(key);
        if (cached !== undefined) {
            return new Map(
                cached.map((item) => [
                    item.movie.id,
                    {
                        movie: item.movie,
                        reasons: new Set(item.reasons),
                        reasonNames: toReasonNameMap(item.reasonNames),
                    },
                ])
            );
        }

        const requests: Array<
            Promise<{
                reason: TmdbDiscoverReason;
                reasonName: string;
                results: TmdbMovieResult[];
            }>
        > = [];
        for (const actor of toNamedEntities(
            movie.actorIds,
            movie.actorNames
        ).slice(0, 5)) {
            requests.push(
                this.discoverMovies(
                    { with_cast: String(actor.id) },
                    'actor',
                    actor.name,
                    language,
                    credential
                )
            );
        }
        for (const director of toNamedEntities(
            movie.directorIds,
            movie.directorNames
        )) {
            requests.push(
                this.discoverMovies(
                    { with_crew: String(director.id) },
                    'director',
                    director.name,
                    language,
                    credential
                )
            );
        }
        for (const producer of toNamedEntities(
            movie.producerIds,
            movie.producerNames
        ).slice(0, 6)) {
            requests.push(
                this.discoverMovies(
                    { with_crew: String(producer.id) },
                    'producer',
                    producer.name,
                    language,
                    credential
                )
            );
        }
        for (const writer of toNamedEntities(
            movie.writerIds,
            movie.writerNames
        ).slice(0, 6)) {
            requests.push(
                this.discoverMovies(
                    { with_crew: String(writer.id) },
                    'writer',
                    writer.name,
                    language,
                    credential
                )
            );
        }
        for (const company of toNamedEntities(
            movie.companyIds,
            movie.companyNames
        ).slice(0, 5)) {
            requests.push(
                this.discoverMovies(
                    { with_companies: String(company.id) },
                    'company',
                    company.name,
                    language,
                    credential
                )
            );
        }
        for (const genre of toNamedEntities(movie.genreIds, movie.genreNames)) {
            requests.push(
                this.discoverMovies(
                    { with_genres: String(genre.id) },
                    'genre',
                    genre.name,
                    language,
                    credential
                )
            );
        }

        const responseGroups = await Promise.all(requests);
        const lookups = new Map<number, TmdbRecommendationLookup>();
        for (const group of responseGroups) {
            for (const result of group.results) {
                if (result.id === movie.id) {
                    continue;
                }

                const existing = lookups.get(result.id);
                if (existing) {
                    existing.reasons.add(group.reason);
                    addReasonName(
                        existing.reasonNames,
                        group.reason,
                        group.reasonName
                    );
                    continue;
                }

                const reasonNames = new Map<TmdbDiscoverReason, Set<string>>();
                addReasonName(reasonNames, group.reason, group.reasonName);
                lookups.set(result.id, {
                    movie: result,
                    reasons: new Set([group.reason]),
                    reasonNames,
                });
            }
        }

        this.setCached(
            key,
            [...lookups.values()].map((item) => ({
                movie: item.movie,
                reasons: [...item.reasons],
                reasonNames: fromReasonNameMap(item.reasonNames),
            }))
        );
        return lookups;
    }

    private async discoverMovies(
        params: Record<string, string>,
        reason: TmdbDiscoverReason,
        reasonName: string,
        language: string,
        credential: string
    ): Promise<{
        reason: TmdbDiscoverReason;
        reasonName: string;
        results: TmdbMovieResult[];
    }> {
        const response = await this.request<TmdbMovieSearchResponse>(
            '/discover/movie',
            {
                ...params,
                include_adult: 'false',
                include_video: 'false',
                language: toTmdbLanguage(language),
                page: '1',
                sort_by: 'primary_release_date.desc',
            },
            credential
        );

        return { reason, reasonName, results: response.results ?? [] };
    }

    private async resolveEntity(
        role: TmdbCatalogEntityRole,
        name: string,
        language: string,
        credential: string
    ): Promise<{ id: number; name: string } | null> {
        if (role === 'company') {
            return this.searchCompany(name, credential);
        }

        if (role === 'genre') {
            return this.findGenre(name, language, credential);
        }

        return this.searchPerson(name, language, credential);
    }

    private async searchPerson(
        name: string,
        language: string,
        credential: string
    ): Promise<{ id: number; name: string } | null> {
        const key = `person:${language}:${normalizeMovieTitle(name)}`;
        const cached = this.getCached<{ id: number; name: string } | null>(key);
        if (cached !== undefined) {
            return cached;
        }

        const response = await this.request<TmdbPersonSearchResponse>(
            '/search/person',
            {
                query: name,
                include_adult: 'false',
                language: toTmdbLanguage(language),
            },
            credential
        );
        const result = response.results?.[0] ?? null;
        this.setCached(key, result);
        return result;
    }

    private async searchCompany(
        name: string,
        credential: string
    ): Promise<{ id: number; name: string } | null> {
        const key = `company:${normalizeMovieTitle(name)}`;
        const cached = this.getCached<{ id: number; name: string } | null>(key);
        if (cached !== undefined) {
            return cached;
        }

        const response = await this.request<TmdbCompanySearchResponse>(
            '/search/company',
            { query: name },
            credential
        );
        const result = response.results?.[0] ?? null;
        this.setCached(key, result);
        return result;
    }

    private async findGenre(
        name: string,
        language: string,
        credential: string
    ): Promise<{ id: number; name: string } | null> {
        const key = `genres:${language}`;
        const cached = this.getCached<Array<{ id: number; name: string }>>(key);
        const genres =
            cached ??
            (
                await this.request<TmdbGenreListResponse>(
                    '/genre/movie/list',
                    { language: toTmdbLanguage(language) },
                    credential
                )
            ).genres ??
            [];
        if (cached === undefined) {
            this.setCached(key, genres);
        }

        const normalizedName = normalizeToken(name);
        return (
            genres.find(
                (genre) => normalizeToken(genre.name) === normalizedName
            ) ?? null
        );
    }

    private mapLookupsToCatalog(
        lookups: Map<number, TmdbRecommendationLookup>,
        candidates: TmdbCatalogCandidate[],
        {
            excludedStreamId,
            limit,
        }: {
            excludedStreamId?: number;
            limit: number;
        }
    ): TmdbSimilarVodRecommendation[] {
        const catalogIndex = buildCatalogIndex(candidates);
        const merged = new Map<number, TmdbSimilarVodRecommendation>();

        for (const lookup of lookups.values()) {
            const catalogItem = findCatalogMatch(catalogIndex, lookup.movie);
            if (!catalogItem) {
                continue;
            }

            const streamId = getCatalogStreamId(catalogItem);
            if (
                !Number.isFinite(streamId) ||
                streamId <= 0 ||
                streamId === excludedStreamId
            ) {
                continue;
            }

            const existing = merged.get(streamId);
            const reasons = toSimilarReasons(lookup.reasons);
            const reasonNames = toSimilarReasonNames(lookup.reasonNames);
            if (existing) {
                existing.reasons = mergeReasons(existing.reasons, reasons);
                existing.reasonNames = mergeReasonNames(
                    existing.reasonNames,
                    reasonNames
                );
                existing.score += reasons.length;
                continue;
            }

            merged.set(streamId, {
                streamId,
                categoryId: getCatalogCategoryId(catalogItem),
                title: getCatalogTitle(catalogItem) || lookup.movie.title || '',
                posterUrl:
                    getCatalogPosterUrl(catalogItem) ||
                    toTmdbImageUrl(this.imageBaseUrl, lookup.movie.poster_path),
                rating:
                    lookup.movie.vote_average !== undefined
                        ? lookup.movie.vote_average.toFixed(1)
                        : undefined,
                year: extractYear(lookup.movie.release_date),
                addedTimestamp: getCatalogAddedTimestamp(catalogItem),
                reasons,
                reasonNames,
                score: scoreReasons(reasons),
            });
        }

        return [...merged.values()]
            .sort(
                (a, b) =>
                    b.score - a.score ||
                    b.addedTimestamp - a.addedTimestamp ||
                    a.title.localeCompare(b.title)
            )
            .slice(0, limit);
    }

    private async request<T>(
        path: string,
        params: Record<string, string>,
        credential: string
    ): Promise<T> {
        const url = new URL(`${this.baseUrl}${path}`);
        for (const [key, value] of Object.entries(params)) {
            url.searchParams.set(key, value);
        }

        const headers: Record<string, string> = {
            accept: 'application/json',
        };
        if (isBearerToken(credential)) {
            headers.Authorization = `Bearer ${credential}`;
        } else {
            url.searchParams.set('api_key', credential);
        }

        const response = await fetch(url, { headers });
        if (!response.ok) {
            throw new Error(`TMDb request failed with ${response.status}`);
        }

        return (await response.json()) as T;
    }

    private getCached<T>(key: string): T | undefined {
        try {
            const raw = localStorage.getItem(this.cacheKey(key));
            if (!raw) {
                return undefined;
            }

            const entry = JSON.parse(raw) as TmdbCacheEntry<T>;
            if (Date.now() > entry.expiresAt) {
                localStorage.removeItem(this.cacheKey(key));
                return undefined;
            }

            return entry.value;
        } catch {
            return undefined;
        }
    }

    private setCached<T>(key: string, value: T): void {
        try {
            const ttlMs = key.startsWith('discover:')
                ? this.discoverCacheTtlMs
                : key.startsWith('details:')
                  ? this.detailsCacheTtlMs
                  : this.searchCacheTtlMs;
            const entry: TmdbCacheEntry<T> = {
                expiresAt: Date.now() + ttlMs,
                value,
            };
            localStorage.setItem(this.cacheKey(key), JSON.stringify(entry));
        } catch {
            // Ignore cache write failures; metadata enrichment is best effort.
        }
    }

    private cacheKey(key: string): string {
        return `iptvnator:tmdb:${key}`;
    }
}

function toEnrichedMovie(
    details: TmdbMovieDetails,
    imageBaseUrl: string
): TmdbEnrichedMovie {
    const crew = details.credits?.crew ?? [];
    const directors = uniqueCrewById(
        crew.filter((item) => item.job === 'Director')
    );
    const producers = uniqueCrewById(
        crew.filter((item) => item.job?.includes('Producer'))
    );
    const writers = uniqueCrewById(
        crew.filter((item) =>
            ['Writer', 'Screenplay', 'Story', 'Characters'].includes(
                item.job ?? ''
            )
        )
    );
    const cast = [...(details.credits?.cast ?? [])]
        .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
        .slice(0, 12);
    const companies = uniqueCompanyById(details.production_companies ?? []);

    return {
        id: details.id,
        title: details.title ?? details.original_title ?? '',
        originalTitle: details.original_title,
        year: extractYear(details.release_date),
        posterUrl: toTmdbImageUrl(imageBaseUrl, details.poster_path),
        rating:
            details.vote_average !== undefined
                ? details.vote_average.toFixed(1)
                : undefined,
        genreNames: details.genres?.map((item) => item.name) ?? [],
        genreIds: details.genres?.map((item) => item.id) ?? [],
        actorNames: cast.map((item) => item.name),
        actorIds: cast.map((item) => item.id),
        directorNames: directors.map((item) => item.name),
        directorIds: directors.map((item) => item.id),
        producerNames: producers.map((item) => item.name),
        producerIds: producers.map((item) => item.id),
        writerNames: writers.map((item) => item.name),
        writerIds: writers.map((item) => item.id),
        companyNames: companies.map((item) => item.name),
        companyIds: companies.map((item) => item.id),
    };
}

function uniqueCrewById(
    items: Array<{ id: number; name: string; job?: string }>
): Array<{ id: number; name: string; job?: string }> {
    return [...new Map(items.map((item) => [item.id, item])).values()];
}

function uniqueCompanyById(
    items: Array<{ id: number; name: string }>
): Array<{ id: number; name: string }> {
    return [...new Map(items.map((item) => [item.id, item])).values()];
}

function buildCatalogIndex(
    candidates: TmdbCatalogCandidate[]
): Map<string, TmdbCatalogCandidate[]> {
    const index = new Map<string, TmdbCatalogCandidate[]>();
    for (const candidate of candidates) {
        const title = getCatalogTitle(candidate);
        if (!title) {
            continue;
        }

        const keys = new Set([
            normalizeMovieTitle(title),
            `${normalizeMovieTitle(title)}:${extractYear(title) ?? ''}`,
        ]);
        const info = getXtreamVodInfo(candidate);
        if (info?.name) {
            keys.add(normalizeMovieTitle(info.name));
        }
        if (candidate.movie_data?.name) {
            keys.add(normalizeMovieTitle(candidate.movie_data.name));
        }

        for (const key of keys) {
            if (!key) {
                continue;
            }
            const entries = index.get(key) ?? [];
            entries.push(candidate);
            index.set(key, entries);
        }
    }

    return index;
}

function findCatalogMatch(
    index: Map<string, TmdbCatalogCandidate[]>,
    movie: TmdbMovieResult
): TmdbCatalogCandidate | null {
    const year = extractYear(movie.release_date);
    const titles = [movie.title, movie.original_title].filter(Boolean);
    for (const title of titles) {
        const normalized = normalizeMovieTitle(title ?? '');
        const exact = year ? index.get(`${normalized}:${year}`)?.[0] : null;
        if (exact) {
            return exact;
        }

        const loose = index.get(normalized)?.[0];
        if (loose) {
            return loose;
        }
    }

    return null;
}

function getCatalogStreamId(candidate: TmdbCatalogCandidate): number {
    return Number(
        candidate.xtream_id ??
            candidate.stream_id ??
            candidate.id ??
            candidate.movie_data?.stream_id
    );
}

function getCatalogCategoryId(candidate: TmdbCatalogCandidate): string {
    return String(
        candidate.category_id ?? candidate.movie_data?.category_id ?? ''
    );
}

function getCatalogTitle(
    candidate: TmdbCatalogCandidate | null | undefined
): string {
    const info = candidate ? getXtreamVodInfo(candidate) : null;
    return (
        info?.name ??
        candidate?.movie_data?.name ??
        candidate?.name ??
        candidate?.title ??
        ''
    ).trim();
}

function getCatalogPosterUrl(
    candidate: TmdbCatalogCandidate
): string | undefined {
    const info = getXtreamVodInfo(candidate);
    return (
        info?.movie_image ??
        info?.cover_big ??
        candidate.stream_icon ??
        candidate.poster_url
    )?.trim();
}

function getCatalogAddedTimestamp(candidate: TmdbCatalogCandidate): number {
    const value = Number(candidate.added_at ?? candidate.added ?? 0);
    if (!Number.isFinite(value) || value <= 0) {
        return 0;
    }

    return value < 100000000000 ? value * 1000 : value;
}

function normalizeMovieTitle(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\([^)]*\)/g, ' ')
        .replace(/\[[^\]]*]/g, ' ')
        .replace(/\b(19|20)\d{2}\b/g, ' ')
        .replace(
            /\b(fr|french|vf|vff|multi|truefrench|vo|vostfr|uhd|hd|4k|1080p|720p|x264|x265|hevc)\b/gi,
            ' '
        )
        .replace(/[^a-z0-9]+/gi, ' ')
        .trim()
        .toLowerCase();
}

function extractYear(value?: string | null): string | undefined {
    return value?.match(/\b(19|20)\d{2}\b/)?.[0];
}

function toTmdbImageUrl(
    imageBaseUrl: string,
    posterPath?: string | null
): string | undefined {
    return posterPath ? `${imageBaseUrl}${posterPath}` : undefined;
}

function isBearerToken(value: string): boolean {
    return value.length > 80 || value.startsWith('eyJ');
}

function toTmdbLanguage(language: string): string {
    return language === 'fr' ? 'fr-FR' : 'en-US';
}

function buildEntityDiscoverParams(
    role: TmdbCatalogEntityRole,
    id: number
): Record<string, string> {
    switch (role) {
        case 'actor':
            return { with_cast: String(id) };
        case 'director':
        case 'producer':
        case 'writer':
            return { with_crew: String(id) };
        case 'company':
            return { with_companies: String(id) };
        case 'genre':
            return { with_genres: String(id) };
    }
}

function normalizeToken(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/gi, ' ')
        .trim()
        .toLowerCase();
}

function toNamedEntities(
    ids: number[],
    names: string[]
): Array<{ id: number; name: string }> {
    return ids
        .map((id, index) => ({
            id,
            name: names[index],
        }))
        .filter((item) => Number.isFinite(item.id) && Boolean(item.name));
}

function addReasonName(
    reasonNames: Map<TmdbDiscoverReason, Set<string>>,
    reason: TmdbDiscoverReason,
    name: string
): void {
    const trimmed = name.trim();
    if (!trimmed) {
        return;
    }

    const names = reasonNames.get(reason) ?? new Set<string>();
    names.add(trimmed);
    reasonNames.set(reason, names);
}

function toReasonNameMap(
    value: Partial<Record<TmdbDiscoverReason, string[]>> | undefined
): Map<TmdbDiscoverReason, Set<string>> {
    const result = new Map<TmdbDiscoverReason, Set<string>>();
    if (!value) {
        return result;
    }

    for (const [reason, names] of Object.entries(value) as Array<
        [TmdbDiscoverReason, string[] | undefined]
    >) {
        const cleanNames = (names ?? [])
            .map((name) => name.trim())
            .filter(Boolean);
        if (cleanNames.length > 0) {
            result.set(reason, new Set(cleanNames));
        }
    }

    return result;
}

function fromReasonNameMap(
    value: Map<TmdbDiscoverReason, Set<string>>
): Partial<Record<TmdbDiscoverReason, string[]>> {
    const result: Partial<Record<TmdbDiscoverReason, string[]>> = {};
    for (const [reason, names] of value.entries()) {
        const cleanNames = [...names].filter(Boolean);
        if (cleanNames.length > 0) {
            result[reason] = cleanNames;
        }
    }

    return result;
}

function toSimilarReasons(
    reasons: Set<TmdbDiscoverReason>
): TmdbSimilarVodReason[] {
    const result: TmdbSimilarVodReason[] = [];
    if (reasons.has('director')) result.push('director');
    if (reasons.has('producer')) result.push('producer');
    if (reasons.has('actor')) result.push('actor');
    if (reasons.has('writer')) result.push('writer');
    if (reasons.has('company')) result.push('company');
    if (reasons.has('genre')) result.push('genre');
    return result;
}

function toSimilarReasonNames(
    value: Map<TmdbDiscoverReason, Set<string>>
): TmdbSimilarVodReasonNames {
    const result: TmdbSimilarVodReasonNames = {};
    for (const [reason, names] of value.entries()) {
        const cleanNames = [...names].filter(Boolean);
        if (cleanNames.length > 0) {
            result[reason] = cleanNames;
        }
    }

    return result;
}

function mergeReasons(
    current: TmdbSimilarVodReason[],
    next: TmdbSimilarVodReason[]
): TmdbSimilarVodReason[] {
    return [...new Set([...current, ...next])];
}

function mergeReasonNames(
    current: TmdbSimilarVodReasonNames | undefined,
    next: TmdbSimilarVodReasonNames
): TmdbSimilarVodReasonNames {
    const result: TmdbSimilarVodReasonNames = { ...(current ?? {}) };
    for (const [reason, names] of Object.entries(next) as Array<
        [TmdbSimilarVodReason, string[] | undefined]
    >) {
        result[reason] = [
            ...new Set([...(result[reason] ?? []), ...(names ?? [])]),
        ];
    }

    return result;
}

function scoreReasons(reasons: TmdbSimilarVodReason[]): number {
    return reasons.reduce((score, reason) => {
        switch (reason) {
            case 'director':
                return score + 8;
            case 'producer':
            case 'writer':
                return score + 6;
            case 'actor':
                return score + 5;
            case 'company':
                return score + 4;
            case 'genre':
                return score + 3;
            default:
                return score + 1;
        }
    }, 0);
}
