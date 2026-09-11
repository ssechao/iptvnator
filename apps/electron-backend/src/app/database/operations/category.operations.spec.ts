import type { AppDatabase } from '../database.types';
import * as schema from '@iptvnator/shared/database/schema';
import {
    getAllCategories,
    getCategories,
    getCategoryVisibilityStateKey,
    saveCategories,
    updateCategoryVisibility,
} from './category.operations';

// Renderer consumers (XCategoryFromDb/XtreamCategoryFromDb) expect category
// rows in this snake_case wire shape. A bare select() would return Drizzle's
// camelCase property names and silently break the playlist backup
// export/restore (issue #1017).
const categoryWireShape = {
    id: schema.categories.id,
    playlist_id: schema.categories.playlistId,
    name: schema.categories.name,
    type: schema.categories.type,
    xtream_id: schema.categories.xtreamId,
    hidden: schema.categories.hidden,
};

function createDbMock(options?: {
    existingCount?: number;
    storedVisibility?: string | null;
}) {
    const existingCount = options?.existingCount ?? 0;
    const storedVisibility = options?.storedVisibility ?? null;
    const existingCategoriesWhere = jest
        .fn()
        .mockResolvedValue([{ count: existingCount }]);
    const existingCategoriesFrom = jest
        .fn()
        .mockReturnValue({ where: existingCategoriesWhere });
    const appStateLimit = jest
        .fn()
        .mockResolvedValue(
            storedVisibility === null ? [] : [{ value: storedVisibility }]
        );
    const appStateWhere = jest.fn().mockReturnValue({ limit: appStateLimit });
    const appStateFrom = jest.fn().mockReturnValue({ where: appStateWhere });
    const select = jest
        .fn()
        .mockReturnValueOnce({ from: existingCategoriesFrom })
        .mockReturnValueOnce({ from: appStateFrom });
    const onConflictDoNothing = jest.fn().mockResolvedValue(undefined);
    const categoryValues = jest.fn().mockReturnValue({ onConflictDoNothing });
    const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
    const appStateValues = jest.fn().mockReturnValue({ onConflictDoUpdate });
    const insert = jest.fn((table) =>
        table === schema.appState
            ? { values: appStateValues }
            : { values: categoryValues }
    );

    return {
        db: {
            select,
            insert,
        } as unknown as AppDatabase,
        insert,
        categoryValues,
        appStateValues,
        onConflictDoNothing,
        onConflictDoUpdate,
        select,
        existingCategoriesWhere,
        appStateWhere,
    };
}

describe('category.operations', () => {
    it('reads visible categories in insertion order to preserve server sorting', async () => {
        const orderBy = jest.fn().mockResolvedValue([]);
        const where = jest.fn().mockReturnValue({ orderBy });
        const from = jest.fn().mockReturnValue({ where });
        const select = jest.fn().mockReturnValue({ from });
        const db = {
            select,
        } as unknown as AppDatabase;

        await getCategories(db, 'playlist-1', 'live');

        expect(orderBy).toHaveBeenCalledWith(schema.categories.id);
        expect(select).toHaveBeenCalledWith(categoryWireShape);
    });

    it('projects all categories to the snake_case wire shape', async () => {
        const orderBy = jest.fn().mockResolvedValue([]);
        const where = jest.fn().mockReturnValue({ orderBy });
        const from = jest.fn().mockReturnValue({ where });
        const select = jest.fn().mockReturnValue({ from });
        const db = {
            select,
        } as unknown as AppDatabase;

        await getAllCategories(db, 'playlist-1', 'movies');

        expect(select).toHaveBeenCalledWith(categoryWireShape);
    });

    it('restores hidden categories when Xtream API category IDs are strings', async () => {
        const { db, categoryValues, insert } = createDbMock();

        await saveCategories(
            db,
            'playlist-1',
            [
                { category_name: 'News', category_id: '101' },
                { category_name: 'Sports', category_id: '102' },
            ],
            'live',
            [102]
        );

        expect(insert).toHaveBeenCalled();
        expect(categoryValues).toHaveBeenCalledWith([
            {
                playlistId: 'playlist-1',
                name: 'News',
                type: 'live',
                xtreamId: 101,
                hidden: false,
            },
            {
                playlistId: 'playlist-1',
                name: 'Sports',
                type: 'live',
                xtreamId: 102,
                hidden: true,
            },
        ]);
    });

    it('skips categories whose Xtream IDs are not numeric', async () => {
        const { db, categoryValues } = createDbMock();

        await saveCategories(
            db,
            'playlist-1',
            [
                { category_name: 'Valid', category_id: '201' },
                { category_name: 'Broken', category_id: 'not-a-number' },
            ],
            'movies',
            [201]
        );

        expect(categoryValues).toHaveBeenCalledWith([
            {
                playlistId: 'playlist-1',
                name: 'Valid',
                type: 'movies',
                xtreamId: 201,
                hidden: true,
            },
        ]);
    });

    it('does not insert categories when all Xtream IDs are invalid', async () => {
        const { db, insert } = createDbMock();

        await saveCategories(
            db,
            'playlist-1',
            [{ category_name: 'Broken', category_id: 'not-a-number' }],
            'series',
            [301]
        );

        expect(insert).not.toHaveBeenCalled();
    });

    it('uses stored hidden category preferences when recreating categories', async () => {
        const { db, categoryValues, appStateValues } = createDbMock({
            storedVisibility: JSON.stringify({
                version: 1,
                hiddenXtreamIds: [102],
            }),
        });

        await saveCategories(
            db,
            'playlist-1',
            [
                { category_name: 'News', category_id: '101' },
                { category_name: 'Sports', category_id: '102' },
            ],
            'live'
        );

        expect(categoryValues).toHaveBeenCalledWith([
            expect.objectContaining({ xtreamId: 101, hidden: false }),
            expect.objectContaining({ xtreamId: 102, hidden: true }),
        ]);
        expect(appStateValues).toHaveBeenCalledWith(
            expect.objectContaining({
                key: getCategoryVisibilityStateKey('playlist-1', 'live'),
                value: JSON.stringify({
                    version: 1,
                    hiddenXtreamIds: [102],
                }),
            })
        );
    });

    it('persists category visibility preferences when visibility changes', async () => {
        const affectedCategoriesWhere = jest.fn().mockResolvedValue([
            { playlistId: 'playlist-1', type: 'movies' },
            { playlistId: 'playlist-1', type: 'movies' },
        ]);
        const affectedCategoriesFrom = jest
            .fn()
            .mockReturnValue({ where: affectedCategoriesWhere });
        const hiddenCategoriesWhere = jest
            .fn()
            .mockResolvedValue([{ xtreamId: 201 }, { xtreamId: 202 }]);
        const hiddenCategoriesFrom = jest
            .fn()
            .mockReturnValue({ where: hiddenCategoriesWhere });
        const select = jest
            .fn()
            .mockReturnValueOnce({ from: affectedCategoriesFrom })
            .mockReturnValueOnce({ from: hiddenCategoriesFrom });
        const updateWhere = jest.fn().mockResolvedValue(undefined);
        const set = jest.fn().mockReturnValue({ where: updateWhere });
        const update = jest.fn().mockReturnValue({ set });
        const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
        const appStateValues = jest
            .fn()
            .mockReturnValue({ onConflictDoUpdate });
        const insert = jest.fn().mockReturnValue({ values: appStateValues });
        const db = { insert, select, update } as unknown as AppDatabase;

        await updateCategoryVisibility(db, [1, 2], true);

        expect(update).toHaveBeenCalledWith(schema.categories);
        expect(set).toHaveBeenCalledWith({ hidden: true });
        expect(appStateValues).toHaveBeenCalledWith(
            expect.objectContaining({
                key: getCategoryVisibilityStateKey('playlist-1', 'movies'),
                value: JSON.stringify({
                    version: 1,
                    hiddenXtreamIds: [201, 202],
                }),
            })
        );
    });
});
