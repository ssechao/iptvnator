import {
    XtreamVodDetails,
    XtreamVodInfo,
    XtreamVodStream,
} from '@iptvnator/shared/interfaces';

export type SimilarVodReason =
    | 'actor'
    | 'director'
    | 'producer'
    | 'writer'
    | 'company'
    | 'genre'
    | 'category';

export interface SimilarVodRecommendation {
    streamId: number;
    categoryId: string;
    title: string;
    posterUrl?: string;
    rating?: string;
    year?: string;
    addedTimestamp: number;
    reasons: SimilarVodReason[];
    reasonNames?: SimilarVodReasonNames;
    score: number;
}

export type SimilarVodReasonNames = Partial<Record<SimilarVodReason, string[]>>;

type SimilarVodCandidate = Partial<XtreamVodStream> &
    Partial<XtreamVodDetails> & {
        id?: string | number;
        poster_url?: string;
        title?: string;
        info?: Partial<XtreamVodInfo> | [] | null;
        category_ids?: Array<string | number>;
    };

interface SimilarVodRecommendationInput {
    currentVodId: number;
    currentDetails: (XtreamVodDetails & SimilarVodCandidate) | null;
    currentCatalogItem?: SimilarVodCandidate | null;
    currentCategoryId?: string | number | null;
    candidates: SimilarVodCandidate[];
    includeCategoryFallback?: boolean;
    limit?: number;
}

const DEFAULT_SIMILAR_VOD_LIMIT = 12;

export function buildSimilarVodRecommendations({
    currentVodId,
    currentDetails,
    currentCatalogItem,
    currentCategoryId,
    candidates,
    includeCategoryFallback = false,
    limit = DEFAULT_SIMILAR_VOD_LIMIT,
}: SimilarVodRecommendationInput): SimilarVodRecommendation[] {
    const currentInfo = getCandidateInfo(currentDetails);
    const currentCategoryIds = new Set(
        [
            currentCategoryId,
            currentDetails?.movie_data?.category_id,
            currentCatalogItem?.category_id,
            ...(currentDetails?.movie_data?.category_ids ?? []),
            ...(currentCatalogItem?.category_ids ?? []),
        ]
            .map(toStringId)
            .filter(Boolean)
    );
    const currentActors = tokenizePeople(
        currentInfo?.actors || currentInfo?.cast
    );
    const currentDirectors = tokenizePeople(currentInfo?.director);
    const currentGenres = tokenizeList(currentInfo?.genre);

    return candidates
        .map((candidate) =>
            scoreSimilarVodCandidate({
                candidate,
                currentVodId,
                currentActors,
                currentDirectors,
                currentGenres,
                currentCategoryIds,
                includeCategoryFallback,
            })
        )
        .filter(
            (
                recommendation
            ): recommendation is SimilarVodRecommendation =>
                recommendation !== null
        )
        .sort(
            (a, b) =>
                b.score - a.score ||
                b.addedTimestamp - a.addedTimestamp ||
                a.title.localeCompare(b.title)
        )
        .slice(0, limit);
}

function scoreSimilarVodCandidate({
    candidate,
    currentVodId,
    currentActors,
    currentDirectors,
    currentGenres,
    currentCategoryIds,
    includeCategoryFallback,
}: {
    candidate: SimilarVodCandidate;
    currentVodId: number;
    currentActors: Map<string, string>;
    currentDirectors: Map<string, string>;
    currentGenres: Map<string, string>;
    currentCategoryIds: Set<string>;
    includeCategoryFallback: boolean;
}): SimilarVodRecommendation | null {
    const streamId = getCandidateStreamId(candidate);
    if (!Number.isFinite(streamId) || streamId <= 0 || streamId === currentVodId) {
        return null;
    }

    const title = getCandidateTitle(candidate);
    if (!title) {
        return null;
    }

    const candidateInfo = getCandidateInfo(candidate);
    const candidateActors = tokenizePeople(
        candidateInfo?.actors || candidateInfo?.cast
    );
    const candidateDirectors = tokenizePeople(candidateInfo?.director);
    const candidateGenres = tokenizeList(candidateInfo?.genre);
    const categoryIds = getCandidateCategoryIds(candidate);

    let score = 0;
    const reasons: SimilarVodReason[] = [];
    const reasonNames: SimilarVodReasonNames = {};

    const directorMatches = intersectNames(currentDirectors, candidateDirectors);
    if (directorMatches.length > 0) {
        score += 6 + directorMatches.length;
        reasons.push('director');
        reasonNames.director = directorMatches;
    }

    const actorMatches = intersectNames(currentActors, candidateActors);
    if (actorMatches.length > 0) {
        score += 4 + Math.min(actorMatches.length, 4);
        reasons.push('actor');
        reasonNames.actor = actorMatches;
    }

    const genreMatches = intersectNames(currentGenres, candidateGenres);
    if (genreMatches.length > 0) {
        score += 3 + Math.min(genreMatches.length, 3);
        reasons.push('genre');
        reasonNames.genre = genreMatches;
    }

    const sameCategory =
        includeCategoryFallback &&
        categoryIds.some((id) => currentCategoryIds.has(id));
    if (sameCategory) {
        score += 1;
        reasons.push('category');
    }

    if (score === 0) {
        return null;
    }

    return {
        streamId,
        categoryId: categoryIds[0] ?? '',
        title,
        posterUrl: getCandidatePosterUrl(candidate),
        rating: getCandidateRating(candidate),
        year: extractYear(candidateInfo?.releasedate) ?? extractYear(title),
        addedTimestamp: getCandidateAddedTimestamp(candidate),
        reasons: dedupeReasons(reasons),
        reasonNames,
        score,
    };
}

function getCandidateInfo(
    candidate: SimilarVodCandidate | null | undefined
): Partial<XtreamVodInfo> | null {
    const info = candidate?.info;
    if (!info || Array.isArray(info) || typeof info !== 'object') {
        return null;
    }

    return info;
}

function getCandidateStreamId(candidate: SimilarVodCandidate): number {
    return Number(
        candidate.xtream_id ??
            candidate.stream_id ??
            candidate.id ??
            candidate.movie_data?.stream_id
    );
}

function getCandidateCategoryIds(candidate: SimilarVodCandidate): string[] {
    return [
        candidate.category_id,
        candidate.movie_data?.category_id,
        ...(candidate.category_ids ?? []),
        ...(candidate.movie_data?.category_ids ?? []),
    ]
        .map(toStringId)
        .filter(Boolean);
}

function getCandidateTitle(candidate: SimilarVodCandidate): string {
    const info = getCandidateInfo(candidate);
    return (
        info?.name ??
        candidate.movie_data?.name ??
        candidate.name ??
        candidate.title ??
        ''
    ).trim();
}

function getCandidatePosterUrl(candidate: SimilarVodCandidate): string | undefined {
    const info = getCandidateInfo(candidate);
    return (
        info?.movie_image ??
        info?.cover_big ??
        candidate.stream_icon ??
        candidate.poster_url
    )?.trim();
}

function getCandidateRating(candidate: SimilarVodCandidate): string | undefined {
    const info = getCandidateInfo(candidate);
    const value = info?.rating_imdb ?? info?.rating ?? candidate.rating_imdb ?? candidate.rating;
    return value === undefined || value === null || value === '' ? undefined : String(value);
}

function getCandidateAddedTimestamp(candidate: SimilarVodCandidate): number {
    const value = Number(candidate.added_at ?? candidate.added ?? 0);
    if (!Number.isFinite(value) || value <= 0) {
        return 0;
    }

    return value < 100000000000 ? value * 1000 : value;
}

function tokenizePeople(value?: string | null): Map<string, string> {
    return tokenizeList(value);
}

function tokenizeList(value?: string | null): Map<string, string> {
    const tokens = new Map<string, string>();
    for (const rawPart of (value ?? '').split(/,|;|\/|\||&|-|\band\b/gi)) {
        const displayName = rawPart.trim();
        const token = normalizeToken(displayName);
        if (token.length > 1 && displayName) {
            tokens.set(token, displayName);
        }
    }

    return tokens;
}

function normalizeToken(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\([^)]*\)/g, '')
        .trim()
        .toLowerCase();
}

function intersectNames(
    left: Map<string, string>,
    right: Map<string, string>
): string[] {
    if (left.size === 0 || right.size === 0) {
        return [];
    }

    const names: string[] = [];
    for (const [token, name] of left.entries()) {
        if (right.has(token)) {
            names.push(name);
        }
    }

    return names;
}

function extractYear(value?: string | null): string | undefined {
    return value?.match(/\b(19|20)\d{2}\b/)?.[0];
}

function toStringId(value: unknown): string {
    return value === undefined || value === null ? '' : String(value);
}

function dedupeReasons(reasons: SimilarVodReason[]): SimilarVodReason[] {
    return [...new Set(reasons)];
}
