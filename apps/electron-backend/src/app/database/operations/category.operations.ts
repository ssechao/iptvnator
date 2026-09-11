import { and, eq, inArray, sql } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';
import { XTREAM_DATABASE_PERFORMANCE_PHASE } from '@iptvnator/shared/interfaces';
import type { AppDatabase } from '../database.types';
import type { DatabaseOperationPerformancePhaseCapture } from './performance-phase-capture';

type DbCategoryType = 'live' | 'movies' | 'series';

type XtreamCategoryInput = {
    category_name: string;
    category_id: string | number;
};

type XtreamCategoryValue = typeof schema.categories.$inferInsert;

type CategoryVisibilityPreference = {
    version: 1;
    hiddenXtreamIds: number[];
};

const CATEGORY_VISIBILITY_STATE_PREFIX = 'xtream-category-visibility';

export function getCategoryVisibilityStateKey(
    playlistId: string,
    type: DbCategoryType
): string {
    return `${CATEGORY_VISIBILITY_STATE_PREFIX}:${playlistId}:${type}`;
}

// Category rows cross the DB-worker IPC boundary in the snake_case wire
// shape declared by XCategoryFromDb/XtreamCategoryFromDb. A bare select()
// would leak Drizzle's camelCase property names (xtreamId, playlistId)
// instead, silently breaking consumers such as the playlist backup
// export/restore (issue #1017).
const categoryWireShape = {
    id: schema.categories.id,
    playlist_id: schema.categories.playlistId,
    name: schema.categories.name,
    type: schema.categories.type,
    xtream_id: schema.categories.xtreamId,
    hidden: schema.categories.hidden,
};

function normalizeXtreamCategoryId(
    rawCategoryId: string | number
): number | null {
    const xtreamId = Number.parseInt(String(rawCategoryId), 10);

    return Number.isNaN(xtreamId) ? null : xtreamId;
}

function normalizeHiddenCategoryXtreamIds(values: unknown[]): number[] {
    return Array.from(
        new Set(
            values
                .map((value) => {
                    if (typeof value === 'number') {
                        return value;
                    }

                    if (typeof value === 'string') {
                        return Number.parseInt(value, 10);
                    }

                    return Number.NaN;
                })
                .filter((value) => Number.isInteger(value) && value >= 0)
        )
    ).sort((a, b) => a - b);
}

function parseStoredHiddenCategoryXtreamIds(value: string | null): number[] {
    if (!value) {
        return [];
    }

    try {
        const parsed = JSON.parse(value) as unknown;

        if (Array.isArray(parsed)) {
            return normalizeHiddenCategoryXtreamIds(parsed);
        }

        if (
            parsed &&
            typeof parsed === 'object' &&
            Array.isArray(
                (parsed as Partial<CategoryVisibilityPreference>)
                    .hiddenXtreamIds
            )
        ) {
            return normalizeHiddenCategoryXtreamIds(
                (parsed as Partial<CategoryVisibilityPreference>)
                    .hiddenXtreamIds ?? []
            );
        }
    } catch {
        return [];
    }

    return [];
}

export async function getStoredHiddenCategoryXtreamIds(
    db: AppDatabase,
    playlistId: string,
    type: DbCategoryType
): Promise<number[]> {
    const rows = await db
        .select({ value: schema.appState.value })
        .from(schema.appState)
        .where(
            eq(
                schema.appState.key,
                getCategoryVisibilityStateKey(playlistId, type)
            )
        )
        .limit(1);

    return parseStoredHiddenCategoryXtreamIds(rows[0]?.value ?? null);
}

export async function storeHiddenCategoryXtreamIds(
    db: AppDatabase,
    playlistId: string,
    type: DbCategoryType,
    hiddenXtreamIds: unknown[]
): Promise<void> {
    const normalizedHiddenXtreamIds =
        normalizeHiddenCategoryXtreamIds(hiddenXtreamIds);
    const updatedAt = new Date().toISOString();
    const value = JSON.stringify({
        version: 1,
        hiddenXtreamIds: normalizedHiddenXtreamIds,
    } satisfies CategoryVisibilityPreference);

    await db
        .insert(schema.appState)
        .values({
            key: getCategoryVisibilityStateKey(playlistId, type),
            value,
            updatedAt,
        })
        .onConflictDoUpdate({
            target: schema.appState.key,
            set: { value, updatedAt },
        });
}

export async function persistCurrentCategoryVisibilityPreference(
    db: AppDatabase,
    playlistId: string,
    type: DbCategoryType
): Promise<void> {
    const hiddenCategories = await db
        .select({ xtreamId: schema.categories.xtreamId })
        .from(schema.categories)
        .where(
            and(
                eq(schema.categories.playlistId, playlistId),
                eq(schema.categories.type, type),
                eq(schema.categories.hidden, true)
            )
        );

    await storeHiddenCategoryXtreamIds(
        db,
        playlistId,
        type,
        hiddenCategories.map((category) => category.xtreamId)
    );
}

function normalizeXtreamCategories(
    playlistId: string,
    categories: XtreamCategoryInput[],
    type: DbCategoryType,
    hiddenCategoryXtreamIds?: number[]
): XtreamCategoryValue[] {
    const hiddenSet = new Set(hiddenCategoryXtreamIds || []);

    return categories.flatMap((category) => {
        const xtreamId = normalizeXtreamCategoryId(category.category_id);

        if (xtreamId === null) {
            return [];
        }

        return [
            {
                playlistId,
                name: category.category_name,
                type,
                xtreamId,
                hidden: hiddenSet.has(xtreamId),
            },
        ];
    });
}

async function insertXtreamCategories(
    db: AppDatabase,
    values: XtreamCategoryValue[]
): Promise<void> {
    await db
        .insert(schema.categories)
        .values(values)
        .onConflictDoNothing({
            target: [
                schema.categories.playlistId,
                schema.categories.type,
                schema.categories.xtreamId,
            ],
        });
}

export async function hasCategories(
    db: AppDatabase,
    playlistId: string,
    type: DbCategoryType
): Promise<boolean> {
    const result = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.categories)
        .where(
            and(
                eq(schema.categories.playlistId, playlistId),
                eq(schema.categories.type, type)
            )
        );

    return result[0].count > 0;
}

export async function getCategories(
    db: AppDatabase,
    playlistId: string,
    type: DbCategoryType,
    capturePhase?: DatabaseOperationPerformancePhaseCapture
) {
    // Xtream categories are inserted once in provider order and existing
    // xtream IDs are preserved, so row id order represents server order.
    // If partial category re-inserts are added later, persist a provider
    // sort index instead of relying on the insertion id.
    const query = db
        .select(categoryWireShape)
        .from(schema.categories)
        .where(
            and(
                eq(schema.categories.playlistId, playlistId),
                eq(schema.categories.type, type),
                eq(schema.categories.hidden, false)
            )
        )
        .orderBy(schema.categories.id);

    return capturePhase
        ? capturePhase.captureAsync(
              XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_CATEGORIES_READ,
              async () => query,
              (rows) => ({ itemCount: rows.length })
          )
        : query;
}

export async function saveCategories(
    db: AppDatabase,
    playlistId: string,
    categories: XtreamCategoryInput[],
    type: DbCategoryType,
    hiddenCategoryXtreamIds?: number[],
    capturePhase?: DatabaseOperationPerformancePhaseCapture
): Promise<{ success: boolean }> {
    if (!categories || categories.length === 0) {
        return { success: true };
    }

    const existingCategories = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.categories)
        .where(
            and(
                eq(schema.categories.playlistId, playlistId),
                eq(schema.categories.type, type)
            )
        );

    if ((existingCategories[0]?.count ?? 0) > 0) {
        return { success: true };
    }

    const persistedHiddenCategoryXtreamIds =
        await getStoredHiddenCategoryXtreamIds(db, playlistId, type);
    const effectiveHiddenCategoryXtreamIds = Array.from(
        new Set([
            ...persistedHiddenCategoryXtreamIds,
            ...(hiddenCategoryXtreamIds ?? []),
        ])
    );

    const values = capturePhase
        ? capturePhase.captureSync(
              XTREAM_DATABASE_PERFORMANCE_PHASE.NORMALIZE_CATEGORIES,
              () =>
                  normalizeXtreamCategories(
                      playlistId,
                      categories,
                      type,
                      effectiveHiddenCategoryXtreamIds
                  ),
              (result) => ({ itemCount: result.length })
          )
        : normalizeXtreamCategories(
              playlistId,
              categories,
              type,
              effectiveHiddenCategoryXtreamIds
          );

    if (values.length === 0) {
        return { success: true };
    }

    if (capturePhase) {
        await capturePhase.captureAsync(
            XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_CATEGORIES_WRITE_TRANSACTIONS,
            () => insertXtreamCategories(db, values),
            () => ({ itemCount: values.length })
        );
    } else {
        await insertXtreamCategories(db, values);
    }

    if (
        hiddenCategoryXtreamIds !== undefined ||
        persistedHiddenCategoryXtreamIds.length > 0
    ) {
        await storeHiddenCategoryXtreamIds(
            db,
            playlistId,
            type,
            effectiveHiddenCategoryXtreamIds
        );
    }

    return { success: true };
}

export async function getAllCategories(
    db: AppDatabase,
    playlistId: string,
    type: DbCategoryType
) {
    return db
        .select(categoryWireShape)
        .from(schema.categories)
        .where(
            and(
                eq(schema.categories.playlistId, playlistId),
                eq(schema.categories.type, type)
            )
        )
        .orderBy(sql`name COLLATE NOCASE`);
}

export async function updateCategoryVisibility(
    db: AppDatabase,
    categoryIds: number[],
    hidden: boolean
): Promise<{ success: boolean }> {
    if (categoryIds.length === 0) {
        return { success: true };
    }

    const affectedCategories = await db
        .select({
            playlistId: schema.categories.playlistId,
            type: schema.categories.type,
        })
        .from(schema.categories)
        .where(inArray(schema.categories.id, categoryIds));

    await db
        .update(schema.categories)
        .set({ hidden })
        .where(inArray(schema.categories.id, categoryIds));

    const affectedScopes = Array.from(
        new Map(
            affectedCategories.map((category) => [
                `${category.playlistId}:${category.type}`,
                category,
            ])
        ).values()
    );

    for (const scope of affectedScopes) {
        await persistCurrentCategoryVisibilityPreference(
            db,
            scope.playlistId,
            scope.type
        );
    }

    return { success: true };
}
