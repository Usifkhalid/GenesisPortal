import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { detectAttachment } from '../src/lib/file-type.js';
import {
  DEFAULT_CALENDAR,
  createSchedule,
  slaDates,
  slaState,
  zoneWallToUtc,
} from '../src/lib/sla.js';
import { matchLocation, ticketNumber } from '../src/modules/tickets/rules.js';

/** Sunday to Thursday, 08:00 to 17:00 on Cairo's clock; 6 October is a holiday. */
const schedule = createSchedule(DEFAULT_CALENDAR, ['2026-10-06']);

/** An instant from a Cairo day and clock time. */
const cairo = (ymd, hhmm) =>
  new Date(
    zoneWallToUtc(ymd, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), 'Africa/Cairo')
  );
const iso = (date) => date.toISOString();

describe('business-hours due dates', () => {
  test('inside one working day the target is simply added', () => {
    // Sunday 11 October 2026.
    assert.equal(
      iso(schedule.add(cairo('2026-10-11', '09:00'), 240)),
      iso(cairo('2026-10-11', '13:00'))
    );
  });

  test('Thursday afternoon runs on into Sunday', () => {
    const thursday = cairo('2026-10-15', '15:00');
    // One hour fits before closing.
    assert.equal(iso(schedule.add(thursday, 60)), iso(cairo('2026-10-15', '16:00')));
    // Eight hours: two on Thursday, six on Sunday.
    assert.equal(iso(schedule.add(thursday, 480)), iso(cairo('2026-10-18', '14:00')));
    // Twenty-four: two on Thursday, nine on Sunday and Monday, four on Tuesday.
    assert.equal(iso(schedule.add(thursday, 1440)), iso(cairo('2026-10-20', '12:00')));
  });

  test('a target that ends at closing time is due at closing time', () => {
    assert.equal(
      iso(schedule.add(cairo('2026-10-15', '16:00'), 60)),
      iso(cairo('2026-10-15', '17:00'))
    );
  });

  test('raised on the weekend or after hours, the clock starts at the next opening', () => {
    const sundayNine = iso(cairo('2026-10-18', '09:00'));
    assert.equal(iso(schedule.add(cairo('2026-10-16', '10:00'), 60)), sundayNine); // Friday
    assert.equal(iso(schedule.add(cairo('2026-10-17', '23:30'), 60)), sundayNine); // Saturday
    assert.equal(iso(schedule.add(cairo('2026-10-15', '18:00'), 60)), sundayNine); // Thursday evening
    // Before opening on a working day.
    assert.equal(
      iso(schedule.add(cairo('2026-10-12', '06:15'), 30)),
      iso(cairo('2026-10-12', '08:30'))
    );
  });

  test('a public holiday is skipped', () => {
    // Monday 5 October 16:00, four hours: one on Monday, none on Tuesday the
    // 6th (Armed Forces Day), three on Wednesday.
    assert.equal(
      iso(schedule.add(cairo('2026-10-05', '16:00'), 240)),
      iso(cairo('2026-10-07', '11:00'))
    );
    // Without the holiday it would be Tuesday.
    assert.equal(
      iso(createSchedule(DEFAULT_CALENDAR).add(cairo('2026-10-05', '16:00'), 240)),
      iso(cairo('2026-10-06', '11:00'))
    );
    assert.equal(schedule.isWorkingDay('2026-10-06'), false);
  });

  test('a daylight-saving change in between does not move the wall-clock time', () => {
    // Summer time ends in the night after Thursday 29 October 2026: Cairo is
    // UTC+3 on the Thursday and UTC+2 on the Sunday.
    const autumn = schedule.add(cairo('2026-10-29', '16:00'), 240);
    assert.equal(iso(cairo('2026-10-29', '16:00')), '2026-10-29T13:00:00.000Z');
    assert.equal(iso(autumn), '2026-11-01T09:00:00.000Z'); // 11:00 in Cairo
    assert.equal(iso(autumn), iso(cairo('2026-11-01', '11:00')));

    // It begins on Friday 24 April 2026: UTC+2 on Thursday, UTC+3 on Sunday.
    const spring = schedule.add(cairo('2026-04-23', '16:00'), 240);
    assert.equal(iso(cairo('2026-04-23', '16:00')), '2026-04-23T14:00:00.000Z');
    assert.equal(iso(spring), '2026-04-26T08:00:00.000Z'); // 11:00 in Cairo

    // And the minutes in between are still the four business hours.
    assert.equal(schedule.between(cairo('2026-10-29', '16:00'), autumn), 240);
    assert.equal(schedule.between(cairo('2026-04-23', '16:00'), spring), 240);
  });

  test('business minutes between two instants count only opening hours', () => {
    assert.equal(
      schedule.between(cairo('2026-10-11', '09:00'), cairo('2026-10-11', '11:30')),
      150
    );
    // Thursday 16:00 to Sunday 09:00: one hour, the weekend, one hour.
    assert.equal(
      schedule.between(cairo('2026-10-15', '16:00'), cairo('2026-10-18', '09:00')),
      120
    );
    // Wholly outside opening hours.
    assert.equal(
      schedule.between(cairo('2026-10-16', '09:00'), cairo('2026-10-17', '09:00')),
      0
    );
    assert.equal(
      schedule.between(cairo('2026-10-11', '12:00'), cairo('2026-10-11', '11:00')),
      0
    );
  });

  test('the calendar is configurable: other days, hours and zone', () => {
    const london = createSchedule({
      timeZone: 'Europe/London',
      workingDays: [1, 2, 3, 4, 5],
      startMin: 540,
      endMin: 1050,
    });
    // Friday 16 October 2026, 17:00 in London (BST, UTC+1): half an hour left.
    const due = london.add(new Date('2026-10-16T16:00:00Z'), 60);
    assert.equal(iso(due), '2026-10-19T08:30:00.000Z'); // Monday 09:30 BST
    assert.equal(london.dayMinutes, 510);
    assert.throws(() => createSchedule({ ...DEFAULT_CALENDAR, workingDays: '' }));
  });
});

describe('SLA dates and state', () => {
  const policy = { firstResponseMinutes: 240, resolveMinutes: 480 };
  const createdAt = cairo('2026-10-11', '09:00');

  test('due dates, and the moment three quarters of each target is used', () => {
    const dates = slaDates({ createdAt, policy }, schedule);
    assert.equal(iso(dates.firstResponseDueAt), iso(cairo('2026-10-11', '13:00')));
    assert.equal(iso(dates.firstResponseRiskAt), iso(cairo('2026-10-11', '12:00')));
    assert.equal(iso(dates.resolveDueAt), iso(cairo('2026-10-11', '17:00')));
    assert.equal(iso(dates.resolveRiskAt), iso(cairo('2026-10-11', '15:00')));
  });

  test('paused minutes push both dates back by as much business time', () => {
    const dates = slaDates({ createdAt, policy, pausedMinutes: 120 }, schedule);
    assert.equal(iso(dates.firstResponseDueAt), iso(cairo('2026-10-11', '15:00')));
    assert.equal(iso(dates.resolveDueAt), iso(cairo('2026-10-12', '10:00')));
  });

  test('state: on track, at risk at 75%, breached, paused, met and missed', () => {
    const dates = slaDates({ createdAt, policy }, schedule);
    const ticket = {
      status: 'Open',
      slaActive: true,
      nextDueAt: dates.firstResponseDueAt,
      nextRiskAt: dates.firstResponseRiskAt,
      resolveDueAt: dates.resolveDueAt,
      resolvedAt: null,
      closedAt: null,
    };
    assert.equal(slaState(ticket, cairo('2026-10-11', '11:59')), 'on_track');
    assert.equal(slaState(ticket, cairo('2026-10-11', '12:00')), 'at_risk');
    assert.equal(slaState(ticket, cairo('2026-10-11', '13:00')), 'breached');
    assert.equal(
      slaState(
        { ...ticket, status: 'Pending', slaActive: false },
        cairo('2026-10-12', '09:00')
      ),
      'paused'
    );
    // Resolved is still open: its clock keeps running until the requester confirms (D143).
    assert.equal(
      slaState(
        { ...ticket, status: 'Resolved', resolvedAt: cairo('2026-10-11', '10:00') },
        cairo('2026-10-11', '13:00')
      ),
      'breached'
    );
    // Closed: judged by the day the requester confirmed (closeMode set) ...
    const closed = { ...ticket, status: 'Closed', slaActive: false, closeMode: 'confirmed' };
    assert.equal(
      slaState({ ...closed, closedAt: cairo('2026-10-11', '16:00') }, new Date()),
      'met'
    );
    assert.equal(
      slaState(
        {
          ...closed,
          resolvedAt: cairo('2026-10-11', '10:00'),
          closedAt: cairo('2026-10-12', '09:00'),
        },
        new Date()
      ),
      'missed',
      'resolved in time but confirmed late'
    );
    // ... and a ticket that closed itself under the old rule keeps its resolved date.
    const legacy = { ...ticket, status: 'Closed', slaActive: false, closeMode: null };
    assert.equal(
      slaState(
        {
          ...legacy,
          resolvedAt: cairo('2026-10-11', '16:00'),
          closedAt: cairo('2026-10-16', '09:00'),
        },
        new Date()
      ),
      'met'
    );
  });
});

describe('ticket rules', () => {
  test('a ticket number is the team code, the year and five digits', () => {
    assert.equal(ticketNumber('IT', 2026, 42), 'IT-2026-00042');
    assert.equal(ticketNumber('IT', 2027, 123456), 'IT-2027-123456');
  });

  test('a location is matched to the directory office whatever the word order', () => {
    const locations = [
      { id: 'hq', nameEn: 'HQ Cairo', nameAr: 'المقر الرئيسي بالقاهرة', isActive: true },
      { id: 'old', nameEn: 'Sebaiya site', nameAr: 'موقع السباعية', isActive: false },
    ];
    assert.equal(matchLocation('Cairo HQ', locations), 'hq');
    assert.equal(matchLocation('hq  cairo', locations), 'hq');
    assert.equal(matchLocation('المقر الرئيسي بالقاهرة', locations), 'hq');
    assert.equal(matchLocation('Sebaiya site', locations), null, 'inactive');
    assert.equal(matchLocation('Eastern Desert Mine Site', locations), null);
    assert.equal(matchLocation(null, locations), null);
  });
});

describe('attachment signatures', () => {
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(16),
  ]);
  const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)]);
  const zip = (...names) =>
    Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(names.join('\0'))]);

  test('an allowed file is recognised by its own bytes', () => {
    assert.equal(detectAttachment(png, 'screen.PNG')?.type, 'image/png');
    assert.equal(
      detectAttachment(Buffer.from('%PDF-1.7\n…'), 'quote.pdf')?.type,
      'application/pdf'
    );
    assert.match(
      detectAttachment(zip('[Content_Types].xml', 'word/document.xml'), 'letter.docx').type,
      /wordprocessingml/
    );
    assert.match(
      detectAttachment(zip('[Content_Types].xml', 'xl/workbook.xml'), 'list.xlsx').type,
      /spreadsheetml/
    );
    const cfb = Buffer.concat([
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      Buffer.alloc(32),
    ]);
    assert.equal(detectAttachment(cfb, 'old.xls')?.type, 'application/vnd.ms-excel');
    assert.equal(
      detectAttachment(Buffer.from('خطأ 0x80070005\r\nline 2\n'), 'setup.log')?.type,
      'text/plain'
    );
    assert.equal(
      detectAttachment(Buffer.from('﻿hello', 'utf16le'), 'note.txt')?.type,
      'text/plain'
    );
  });

  test('archives, executables and renamed files are refused', () => {
    assert.equal(detectAttachment(zip('a.txt'), 'files.zip'), null, 'an archive');
    assert.equal(detectAttachment(exe, 'tool.exe'), null, 'an executable');
    assert.equal(detectAttachment(exe, 'tool.png'), null, 'an executable named as an image');
    assert.equal(detectAttachment(exe, 'tool.txt'), null, 'an executable named as text');
    assert.equal(
      detectAttachment(zip('a.txt'), 'files.docx'),
      null,
      'a zip named as a document'
    );
    assert.equal(
      detectAttachment(zip('[Content_Types].xml', 'xl/workbook.xml'), 'list.docx'),
      null,
      'a workbook named as a document'
    );
    assert.equal(detectAttachment(png, 'screen.pdf'), null, 'an image named as a PDF');
    assert.equal(detectAttachment(png, 'screen'), null, 'no extension');
    assert.equal(detectAttachment(Buffer.from('<svg/>'), 'logo.svg'), null);
    assert.equal(detectAttachment(Buffer.from('<script>'), 'page.html'), null);
    assert.equal(detectAttachment(Buffer.alloc(0), 'empty.txt'), null);
  });
});
