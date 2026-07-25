import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
    artistOverlaps,
    normalizeArtist,
    normalizeTitle,
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

test('normalizeTitle strips everything from the first dash separator', () => {
    assert.deepEqual(normalizeTitle('Song - Radio Edit'), {
        full: 'song radio edit',
        stripped: 'song',
    });
    assert.deepEqual(normalizeTitle('Song - Remastered 2011'), {
        full: 'song remastered 2011',
        stripped: 'song',
    });
    assert.equal(normalizeTitle('Song - Live - Acoustic').stripped, 'song');
});

test('normalizeTitle strips a bracketed tail left behind by a dash tail', () => {
    assert.equal(normalizeTitle('Song (Live) - Remaster').stripped, 'song');
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
    assert.ok(titleMatches(reaper, reaper));
    assert.ok(
        titleMatches("(Don't Fear) The Reaper", '(Don’t Fear) The Reaper'),
    );

    assert.equal(normalizeTitle('Song - Part 2').full, 'song part 2');
    assert.equal(normalizeTitle('Song - Part 2').stripped, 'song');
    assert.ok(titleMatches('Song - Part 2', 'Song - Part 2'));
});

test('titleMatches refuses to match a dash tail against a bare title', () => {
    assert.equal(titleMatches('Song - Part 2', 'Song'), false);
    assert.equal(titleMatches('Song', 'Song - Part 2'), false);
});

test('titleMatches refuses to match a decorated title against a bare one', () => {
    assert.equal(titleMatches('Song (feat. Artist)', 'Song'), false);
    assert.equal(titleMatches('Song [Bonus Track]', 'Song'), false);
});

test('titleMatches accepts two differently decorated forms of one title', () => {
    assert.ok(titleMatches('Song (feat. A)', 'Song feat. A'));
    assert.ok(titleMatches('Song (feat. A, B)', 'Song feat. A'));
    assert.ok(titleMatches('Song - Remastered 2011', 'Song (Remastered)'));
});

test('titleMatches ignores case, diacritics and punctuation', () => {
    assert.ok(titleMatches('THE ROAD', 'the road'));
    assert.ok(titleMatches('Cafe Society', 'Café Society'));
    assert.ok(titleMatches('Hello World', 'Hello, World!'));
});

test('titleMatches rejects unrelated titles', () => {
    assert.equal(titleMatches('Song', 'Another Song'), false);
    assert.equal(titleMatches('Song feat. A', 'Another Song feat. A'), false);
});

test('normalizeTitle strips a Cyrillic feat clause from the real source data', () => {
    assert.deepEqual(normalizeTitle('Быть богатым feat. Платина'), {
        full: 'быть богатым feat платина',
        stripped: 'быть богатым',
    });
});

test('normalizeTitle folds Cyrillic case', () => {
    assert.equal(normalizeTitle('тРи пОлОсКи').full, 'три полоски');
    assert.ok(titleMatches('тРи пОлОсКи', 'Три Полоски'));
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
