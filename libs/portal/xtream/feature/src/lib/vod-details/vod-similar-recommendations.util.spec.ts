import { buildSimilarVodRecommendations } from './vod-similar-recommendations.util';

describe('buildSimilarVodRecommendations', () => {
    it('scores movies with matching director, actors, and genre', () => {
        const recommendations = buildSimilarVodRecommendations({
            currentVodId: 10,
            currentCategoryId: '42',
            currentDetails: {
                info: {
                    name: 'Current Movie',
                    actors: 'Kevin Costner, Amy Adams',
                    director: 'Niki Caro',
                    genre: 'Drama, Sport',
                },
                movie_data: {
                    stream_id: 10,
                    name: 'Current Movie',
                    added: '1710000000',
                    category_id: '42',
                    container_extension: 'mkv',
                    custom_sid: null,
                    direct_source: '',
                },
            },
            candidates: [
                {
                    stream_id: 10,
                    name: 'Current Movie',
                    category_id: '42',
                },
                {
                    stream_id: 11,
                    name: 'Same Director',
                    stream_icon: 'https://example.com/director.jpg',
                    added: '1711000000',
                    category_id: '99',
                    info: {
                        director: 'Niki Caro',
                        genre: 'Biography',
                        releasedate: '2020-01-01',
                    },
                },
                {
                    stream_id: 12,
                    name: 'Same Actor',
                    added: '1712000000',
                    category_id: '43',
                    info: {
                        actors: 'Amy Adams',
                        genre: 'Comedy',
                    },
                },
                {
                    stream_id: 13,
                    name: 'Same Category',
                    added: '1713000000',
                    category_id: '42',
                },
            ],
        });

        expect(recommendations.map((item) => item.streamId)).toEqual([
            11, 12,
        ]);
        expect(recommendations[0]).toEqual(
            expect.objectContaining({
                title: 'Same Director',
                posterUrl: 'https://example.com/director.jpg',
                year: '2020',
                reasons: ['director'],
                reasonNames: {
                    director: ['Niki Caro'],
                },
            })
        );
        expect(recommendations[1].reasons).toEqual(['actor']);
        expect(recommendations[1].reasonNames).toEqual({
            actor: ['Amy Adams'],
        });
    });

    it('can keep latest movies first when category fallback is explicitly enabled', () => {
        const recommendations = buildSimilarVodRecommendations({
            currentVodId: 1,
            currentCategoryId: '10',
            includeCategoryFallback: true,
            currentDetails: {
                info: {
                    name: 'Current Thriller',
                    genre: 'Thriller',
                },
            },
            candidates: [
                {
                    stream_id: 2,
                    name: 'Older Thriller',
                    category_id: '10',
                    added: '1700000000',
                },
                {
                    stream_id: 3,
                    name: 'Newer Thriller',
                    category_id: '10',
                    added: '1800000000',
                },
            ],
        });

        expect(recommendations.map((item) => item.title)).toEqual([
            'Newer Thriller',
            'Older Thriller',
        ]);
        expect(recommendations[0].reasons).toEqual(['category']);
    });
});
