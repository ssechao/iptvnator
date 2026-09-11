import * as schema from '@iptvnator/shared/database/schema';
import type { AppDatabase } from '../database.types';
import { getCategoryVisibilityStateKey } from './category.operations';
import { deleteXtreamContent } from './xtream.operations';

function selectWhere(result: unknown[]) {
    const where = jest.fn().mockResolvedValue(result);
    const from = jest.fn().mockReturnValue({ where });

    return {
        from,
        query: { from },
        where,
    };
}

function selectJoinWhere(result: unknown[]) {
    const where = jest.fn().mockResolvedValue(result);
    const innerJoin = jest.fn().mockReturnValue({ where });
    const from = jest.fn().mockReturnValue({ innerJoin });

    return {
        from,
        innerJoin,
        query: { from },
        where,
    };
}

function selectJoinWhereGroupBy(result: unknown[]) {
    const groupBy = jest.fn().mockResolvedValue(result);
    const where = jest.fn().mockReturnValue({ groupBy });
    const innerJoin = jest.fn().mockReturnValue({ where });
    const from = jest.fn().mockReturnValue({ innerJoin });

    return { query: { from } };
}

describe('xtream.operations', () => {
    it('does not erase stored visibility when an interrupted refresh left no categories', async () => {
        const categoriesQuery = selectWhere([]);
        const insert = jest.fn();
        const transaction = jest.fn();
        const db = {
            insert,
            select: jest.fn().mockReturnValue(categoriesQuery.query),
            transaction,
        } as unknown as AppDatabase;

        await expect(deleteXtreamContent(db, 'playlist-1')).resolves.toEqual({
            success: true,
            favorites: [],
            recentlyViewed: [],
            hiddenCategories: [],
        });

        expect(insert).not.toHaveBeenCalled();
        expect(transaction).not.toHaveBeenCalled();
    });

    it('persists category visibility preferences before deleting refresh content', async () => {
        const categoriesQuery = selectWhere([
            {
                id: 1,
                xtreamId: 101,
                type: 'live',
                hidden: false,
            },
            {
                id: 2,
                xtreamId: 102,
                type: 'live',
                hidden: true,
            },
            {
                id: 3,
                xtreamId: 201,
                type: 'movies',
                hidden: true,
            },
            {
                id: 4,
                xtreamId: 301,
                type: 'series',
                hidden: false,
            },
        ]);
        const favoritesQuery = selectJoinWhere([]);
        const recentlyViewedQuery = selectJoinWhere([]);
        const contentRowsQuery = selectJoinWhereGroupBy([]);
        const select = jest
            .fn()
            .mockReturnValueOnce(categoriesQuery.query)
            .mockReturnValueOnce(favoritesQuery.query)
            .mockReturnValueOnce(recentlyViewedQuery.query)
            .mockReturnValueOnce(contentRowsQuery.query);
        const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
        const appStateValues = jest
            .fn()
            .mockReturnValue({ onConflictDoUpdate });
        const insert = jest.fn().mockReturnValue({ values: appStateValues });
        const run = jest.fn(() => ({ changes: 4 }));
        const deleteWhere = jest.fn().mockReturnValue({ run });
        const deleteFrom = jest.fn().mockReturnValue({ where: deleteWhere });
        const transaction = jest.fn((callback: (tx: unknown) => unknown) =>
            callback({ delete: deleteFrom })
        );
        const db = {
            insert,
            select,
            transaction,
        } as unknown as AppDatabase;

        const result = await deleteXtreamContent(db, 'playlist-1');

        expect(result.hiddenCategories).toEqual([
            {
                xtreamId: 102,
                categoryType: 'live',
            },
            {
                xtreamId: 201,
                categoryType: 'movies',
            },
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
        expect(appStateValues).toHaveBeenCalledWith(
            expect.objectContaining({
                key: getCategoryVisibilityStateKey('playlist-1', 'movies'),
                value: JSON.stringify({
                    version: 1,
                    hiddenXtreamIds: [201],
                }),
            })
        );
        expect(appStateValues).toHaveBeenCalledWith(
            expect.objectContaining({
                key: getCategoryVisibilityStateKey('playlist-1', 'series'),
                value: JSON.stringify({
                    version: 1,
                    hiddenXtreamIds: [],
                }),
            })
        );
        expect(transaction).toHaveBeenCalled();
        expect(deleteFrom).toHaveBeenCalledWith(schema.categories);
    });
});
