import { describe, expect, it } from 'vitest';
import { soundsFinished } from '@/lib/update-signals';

describe('soundsFinished (docs/56 MDA-07)', () => {
  it('hears finished work, typos included', () => {
    for (const text of ['completed the shop setup', 'complted', 'Done.', 'PR merged, deployed to staging', 'Fixed and shipped', 'All wrapped up for today']) {
      expect(soundsFinished(text)).toBe(true);
    }
  });

  it('ignores plans, hedges, negations and questions', () => {
    for (const text of ['not done yet', 'almost finished', 'will be done tomorrow', 'should be merged after review', "isn't fixed", 'Is this done?', 'waiting to get it deployed', 'worked on prod', '', null]) {
      expect(soundsFinished(text)).toBe(false);
    }
  });

  it('reads sentence by sentence', () => {
    expect(soundsFinished('Not sure about the API. Migration is done.')).toBe(true);
  });
});
