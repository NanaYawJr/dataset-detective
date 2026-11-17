import { describe, expect, it } from 'vitest';
import { APP_VERSION, feedbackBody, feedbackCsv, isEmail, type FeedbackDraft, type FeedbackEntry } from './feedback';

const draft: FeedbackDraft = {
  rating: 4,
  comment: '  Useful, but slow on Excel.  ',
  wantsReply: false,
  name: 'Ama',
  country: 'Ghana',
  email: 'ama@example.com',
  website: '',
};

describe('feedbackBody', () => {
  it('leaves out contact details unless a reply is wanted', () => {
    expect(feedbackBody(draft, 'excel')).toEqual({
      rating: 4,
      comment: 'Useful, but slow on Excel.',
      wants_reply: false,
      app_version: APP_VERSION,
      file_kind: 'excel',
      website: '',
    });
    expect(feedbackBody({ ...draft, wantsReply: true }, null)).toMatchObject({
      wants_reply: true,
      name: 'Ama',
      country: 'Ghana',
      email: 'ama@example.com',
      file_kind: '',
    });
  });

  it('knows the version it was built from', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('checks email addresses loosely', () => {
    expect(isEmail(' kofi@example.co.uk ')).toBe(true);
    expect(isEmail('kofi@example')).toBe(false);
    expect(isEmail('not an email')).toBe(false);
  });
});

describe('feedbackCsv', () => {
  it('quotes what needs quoting and stops formulas running in a spreadsheet', () => {
    const entry: FeedbackEntry = {
      id: 1,
      created_at: '2026-11-17T10:00:00+00:00',
      rating: 2,
      comment: 'Said "day-first", then\nchanged its mind',
      wants_reply: true,
      name: '=HYPERLINK("x")',
      country: 'Canada',
      email: 'kofi@example.com',
      app_version: '0.7.0',
      file_kind: 'excel',
    };
    const [header, row] = feedbackCsv([entry]).split('\r\n');
    expect(header).toBe('created_at,rating,comment,wants_reply,name,country,email,app_version,file_kind');
    expect(row).toBe(
      `2026-11-17T10:00:00+00:00,2,"Said ""day-first"", then\nchanged its mind",true,"'=HYPERLINK(""x"")",Canada,kofi@example.com,0.7.0,excel`.split(
        '\r\n',
      )[0],
    );
  });
});
