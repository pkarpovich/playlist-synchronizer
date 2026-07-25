import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
    artistOverlaps,
    censoredTitlePattern,
    closestByDuration,
    isPrefixMatch,
    normalizeArtist,
    normalizeTitle,
    sourceTitleForms,
    titleMatches,
} from './spotify-match.helpers.js';
import { SpotifyTrack } from './spotify-types.js';

function trackWithArtists(...names: string[]): SpotifyTrack {
    return {
        uri: 'spotify:track:1',
        name: 'Any Title',
        artists: names.map((name) => ({ name })),
    };
}

function candidate(
    name: string,
    durationMs?: number,
    uri = 'spotify:track:1',
): SpotifyTrack {
    return {
        uri,
        name,
        artists: [{ name: 'Any Artist' }],
        ...(durationMs === undefined ? {} : { duration_ms: durationMs }),
    };
}

function matches(candidateName: string, name: string, version?: string) {
    return titleMatches(candidateName, sourceTitleForms({ name, version }));
}

test('normalizeTitle strips a bracketed feat clause', () => {
    assert.deepEqual(normalizeTitle('Song (feat. Artist)'), {
        full: 'song feat artist',
        stripped: 'song',
    });
});

test('normalizeTitle strips a bare feat clause in both spellings', () => {
    assert.deepEqual(normalizeTitle('Song feat. Artist'), {
        full: 'song feat artist',
        stripped: 'song',
    });
    assert.deepEqual(normalizeTitle('Song ft. Artist'), {
        full: 'song ft artist',
        stripped: 'song',
    });
    assert.deepEqual(normalizeTitle('Song ft Artist'), {
        full: 'song ft artist',
        stripped: 'song',
    });
});

test('normalizeTitle strips a bracketed tail', () => {
    assert.deepEqual(normalizeTitle('Song [Bonus Track]'), {
        full: 'song bonus track',
        stripped: 'song',
    });
});

test('normalizeTitle strips repeated bracketed tails', () => {
    assert.deepEqual(normalizeTitle('Song (feat. Artist) [Bonus Track]'), {
        full: 'song feat artist bonus track',
        stripped: 'song',
    });
});

test('normalizeTitle strips an annotation dash tail', () => {
    assert.deepEqual(normalizeTitle('Song - Remastered 2011'), {
        full: 'song remastered 2011',
        stripped: 'song',
    });
    assert.equal(normalizeTitle('Song - prod. by Someone').stripped, 'song');
    assert.equal(normalizeTitle('Song - feat. Someone').stripped, 'song');
    assert.equal(normalizeTitle('Song - from "A Film"').stripped, 'song');
});

test('normalizeTitle keeps a dash tail that marks a different recording', () => {
    assert.deepEqual(normalizeTitle('Song - Radio Edit'), {
        full: 'song radio edit',
        stripped: 'song radio edit',
    });
    assert.equal(normalizeTitle('Song - Live').stripped, 'song live');
    assert.equal(normalizeTitle('Song - Acoustic').stripped, 'song acoustic');
    assert.equal(matches('Song - Live', 'Song'), false);
});

test('normalizeTitle strips a bracketed tail left behind by a dash tail', () => {
    assert.equal(normalizeTitle('Song (Live) - Remaster').stripped, 'song');
});

test('normalizeTitle strips any bracketed tail, so duration guards the variants', () => {
    assert.equal(normalizeTitle('Song (Live)').stripped, 'song');
    assert.equal(normalizeTitle('merci (мерси)').stripped, 'merci');
    assert.ok(matches('Song (Live)', 'Song'));
    assert.ok(matches('merci', 'merci (мерси)'));
});

test('normalizeTitle keeps a dash that is not a separator', () => {
    assert.deepEqual(normalizeTitle('Twenty-One'), {
        full: 'twenty one',
        stripped: 'twenty one',
    });
});

test('normalizeTitle folds diacritics away', () => {
    assert.equal(normalizeTitle('Björk Café').full, 'bjork cafe');
    assert.equal(normalizeArtist('Beyoncé'), 'beyonce');
});

test('normalizeTitle turns an ampersand into the word and', () => {
    assert.equal(normalizeTitle('Salt & Pepper').full, 'salt and pepper');
    assert.equal(
        normalizeArtist('Simon & Garfunkel'),
        normalizeArtist('Simon and Garfunkel'),
    );
});

test('normalizeTitle replaces punctuation with a space', () => {
    assert.equal(normalizeTitle('Hello, World!').full, 'hello world');
    assert.equal(normalizeTitle("Don't").full, 'don t');
    assert.equal(normalizeTitle('Don’t').full, 'don t');
});

test('normalizeTitle collapses and trims whitespace', () => {
    assert.deepEqual(normalizeTitle('   Song    Title   '), {
        full: 'song title',
        stripped: 'song title',
    });
});

test('normalizeTitle leaves an undecorated title identical in both forms', () => {
    assert.deepEqual(normalizeTitle('Song'), {
        full: 'song',
        stripped: 'song',
    });
});

test('normalizeTitle never lets the stripped form collapse to nothing', () => {
    assert.deepEqual(normalizeTitle('(Live)'), {
        full: 'live',
        stripped: 'live',
    });
    assert.deepEqual(normalizeTitle(' - Interlude'), {
        full: 'interlude',
        stripped: 'interlude',
    });
});

test('titleMatches accepts identical titles that survive normalization', () => {
    const reaper = "(Don't Fear) The Reaper";

    assert.equal(normalizeTitle(reaper).full, 'don t fear the reaper');
    assert.equal(normalizeTitle(reaper).stripped, 'don t fear the reaper');
    assert.ok(matches(reaper, reaper));
    assert.ok(matches("(Don't Fear) The Reaper", '(Don’t Fear) The Reaper'));
    assert.ok(matches('Song - Part 2', 'Song - Part 2'));
});

test('titleMatches keeps a non-annotation dash tail apart from a bare title', () => {
    assert.equal(normalizeTitle('Song - Part 2').stripped, 'song part 2');
    assert.equal(matches('Song - Part 2', 'Song'), false);
    assert.equal(matches('Song', 'Song - Part 2'), false);
});

test('titleMatches accepts an annotation present on only one side', () => {
    assert.ok(matches('Song (feat. Artist)', 'Song'));
    assert.ok(matches('Song', 'Song (feat. Artist)'));
    assert.ok(matches('Song [Bonus Track]', 'Song'));
    assert.ok(matches('Song - prod. by Someone', 'Song'));
    assert.ok(matches('Song', 'Song - from "A Film"'));
    assert.ok(matches('Song - Remastered 2011', 'Song'));
});

test('titleMatches accepts two differently decorated forms of one title', () => {
    assert.ok(matches('Song (feat. A)', 'Song feat. A'));
    assert.ok(matches('Song (feat. A, B)', 'Song feat. A'));
    assert.ok(matches('Song - Remastered 2011', 'Song (Remastered)'));
});

test('titleMatches ignores case, diacritics and punctuation', () => {
    assert.ok(matches('THE ROAD', 'the road'));
    assert.ok(matches('Cafe Society', 'Café Society'));
    assert.ok(matches('Hello World', 'Hello, World!'));
});

test('titleMatches rejects unrelated titles', () => {
    assert.equal(matches('Song', 'Another Song'), false);
    assert.equal(matches('Song feat. A', 'Another Song feat. A'), false);
    assert.equal(matches('Miami 96', 'Miami'), false);
});

test('normalizeTitle strips a Cyrillic feat clause from the real source data', () => {
    assert.deepEqual(normalizeTitle('Быть богатым feat. Платина'), {
        full: 'быть богатым feat платина',
        stripped: 'быть богатым',
    });
    assert.ok(matches('Быть богатым', 'Быть богатым feat. Платина'));
});

test('normalizeTitle folds Cyrillic case', () => {
    assert.equal(normalizeTitle('тРи пОлОсКи').full, 'три полоски');
    assert.ok(matches('тРи пОлОсКи', 'Три Полоски'));
});

test('sourceTitleForms carries the Yandex version field into matchable forms', () => {
    const forms = sourceTitleForms({
        name: 'Пятна',
        version: 'from "Арлан. Решающий раунд"',
    });

    assert.ok(forms.has('пятна'));
    assert.ok(titleMatches('Пятна - from "Арлан. Решающий раунд"', forms));
    assert.ok(titleMatches('Пятна (from "Арлан. Решающий раунд")', forms));
    assert.ok(titleMatches('Пятна', forms));
});

test('sourceTitleForms matches the real version-carrying source tracks', () => {
    assert.ok(
        matches(
            'Силуэт (из к/ф «Алиса в Стране Чудес»)',
            'Силуэт',
            'из к/ф «Алиса в Стране Чудес»',
        ),
    );
    assert.ok(
        matches(
            'BL0O0M.onion - prod. by gufani244',
            'BL0O0M.onion',
            'prod. by gufani244',
        ),
    );
    assert.ok(matches('АЗБУКА', 'АЗБУКА  (Prod. by meep)', 'feat. BATO'));
});

test('sourceTitleForms without a version yields only the plain forms', () => {
    assert.deepEqual([...sourceTitleForms({ name: 'Song (feat. A)' })].sort(), [
        'song',
        'song feat a',
    ]);
});

test('closestByDuration picks the nearest candidate, not the first', () => {
    const chosen = closestByDuration(
        [
            candidate('Всё просто (RMX)', 185142, 'spotify:track:rmx'),
            candidate('Всё просто', 201857, 'spotify:track:original'),
        ],
        201850,
        5000,
    );

    assert.equal(chosen?.uri, 'spotify:track:original');
});

test('closestByDuration separates two masters of the same title', () => {
    const chosen = closestByDuration(
        [
            candidate('Танцы на снегу', 185941, 'spotify:track:other'),
            candidate('Танцы на снегу', 183765, 'spotify:track:exact'),
        ],
        183760,
        5000,
    );

    assert.equal(chosen?.uri, 'spotify:track:exact');
});

test('closestByDuration rejects everything outside the tolerance', () => {
    assert.equal(
        closestByDuration([candidate('Song', 120000)], 100000, 5000),
        null,
    );
    assert.equal(closestByDuration([], 100000, 5000), null);
});

test('closestByDuration falls back to the first candidate without durations', () => {
    assert.equal(
        closestByDuration([candidate('Song')], 100000, 5000)?.name,
        'Song',
    );
    assert.equal(
        closestByDuration([candidate('Song', 120000)], undefined, 5000)?.name,
        'Song',
    );
});

test('censoredTitlePattern turns asterisks into single-character wildcards', () => {
    const pattern = censoredTitlePattern('так по***');

    assert.ok(pattern);
    assert.ok(pattern?.test('так похуй'));
    assert.equal(pattern?.test('так по'), false);
    assert.equal(pattern?.test('так похуже'), false);
    assert.equal(censoredTitlePattern('так похуй'), null);
});

test('censoredTitlePattern escapes regex metacharacters in the title', () => {
    const pattern = censoredTitlePattern('a.b**');

    assert.ok(pattern?.test('a.bcd'));
    assert.equal(pattern?.test('axbcd'), false);
});

test('isPrefixMatch accepts an added suffix in either direction', () => {
    assert.ok(isPrefixMatch('Miami 96', 'Miami'));
    assert.ok(isPrefixMatch('Miami', 'Miami 96'));
    assert.equal(isPrefixMatch('Miura 2', 'Milan'), false);
    assert.equal(isPrefixMatch('', 'Miami'), false);
});

test('artistOverlaps accepts an exact normalized match', () => {
    assert.ok(artistOverlaps(trackWithArtists('Платина'), ['платина']));
    assert.ok(
        artistOverlaps(trackWithArtists('Simon & Garfunkel'), [
            'Simon and Garfunkel',
        ]),
    );
    assert.ok(
        artistOverlaps(trackWithArtists('Other Artist', 'Beyoncé'), [
            'Jay-Z',
            'Beyonce',
        ]),
    );
});

test('artistOverlaps does not bridge cross-script aliases', () => {
    assert.equal(
        artistOverlaps(trackWithArtists('Skryptonite'), ['Скриптонит']),
        false,
    );
    assert.equal(artistOverlaps(trackWithArtists('Husky'), ['Хаски']), false);
});

test('artistOverlaps rejects unrelated and empty artist lists', () => {
    assert.equal(
        artistOverlaps(trackWithArtists('Someone'), ['Nobody']),
        false,
    );
    assert.equal(artistOverlaps(trackWithArtists('Someone'), []), false);
    assert.equal(artistOverlaps(trackWithArtists(), ['Someone']), false);
});
