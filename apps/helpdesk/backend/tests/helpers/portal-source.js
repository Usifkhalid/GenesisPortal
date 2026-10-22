/**
 * A fake portal database for the migration tests (D145): arrays of rows
 * behind the few Prisma reads from-portal.js makes (findMany and count with
 * equality, `in`, `startsWith`, `OR` and `select`). Fake names and domains
 * only. `portalFixture()` is a small portal with three companies, the IT team
 * and its settings, three tickets (one from last year) with replies, notes,
 * history, attachments, notifications and audit rows.
 */

import { randomUUID } from 'node:crypto';

function matches(row, where = {}) {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return cond.some((w) => matches(row, w));
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond) return cond.in.includes(row[key]);
      if ('startsWith' in cond) return String(row[key] ?? '').startsWith(cond.startsWith);
    }
    return row[key] === cond;
  });
}

/** @param {Record<string, object[]>} tables  by Prisma delegate name: company, ticket, ... */
export function createArraySource(tables) {
  const delegate = (rows) => ({
    async findMany({ where, select } = {}) {
      return rows
        .filter((r) => matches(r, where))
        .map((r) =>
          structuredClone(
            select ? Object.fromEntries(Object.keys(select).map((k) => [k, r[k]])) : r
          )
        );
    },
    async count({ where } = {}) {
      return rows.filter((r) => matches(r, where)).length;
    },
    async create() {
      throw new Error('a fake portal source is never written');
    },
  });
  return new Proxy(
    { $disconnect: async () => {} },
    {
      get: (base, key) =>
        key in base
          ? base[key]
          : typeof key === 'string'
            ? delegate(tables[key] ?? [])
            : undefined,
    }
  );
}

const at = (iso) => new Date(iso);
const stamps = (iso) => ({ createdAt: at(iso), updatedAt: at(iso) });

/** The portal's data, plus the ids and files the tests look at. */
export function portalFixture() {
  const id = () => randomUUID();
  const ids = {
    GEN: id(),
    MSR: id(),
    HLD: id(),
    dept: id(),
    team: id(),
    catLaptop: id(),
    catPrinters: id(),
    catOld: id(),
    locHq: id(),
    locSite: id(),
    T1: id(),
    T2: id(),
    T3: id(),
    C1: id(),
    C2: id(),
    C3: id(),
  };
  const company = (code, domain, nameEn) => ({
    id: ids[code],
    code,
    nameEn,
    nameAr: `شركة ${code}`,
    domain,
    accentColor: '#225588',
    logoUrl: `/assets/img/companies/${code.toLowerCase()}.svg`,
    logoKey: null,
    isActive: true,
    showMobileInDirectory: false,
    workdayStartMin: 480,
    workdayEndMin: 1080,
    workingDays: '0,1,2,3,4',
    ...stamps('2026-10-07T08:00:00Z'),
  });
  const companies = [
    company('GEN', 'gen.example.org', 'Fake Mining'),
    company('MSR', 'msr.example.org', 'Fake Construction'),
    company('HLD', 'hld.example.org', 'Fake Holding'),
  ];
  const domains = [
    ...companies.map((c) => ({
      id: id(),
      companyId: c.id,
      domain: c.domain,
      ...stamps('2026-10-07T08:00:00Z'),
    })),
    {
      id: id(),
      companyId: ids.GEN,
      domain: 'gen-alt.example.org',
      ...stamps('2026-10-08T08:00:00Z'),
    },
  ];

  const person = (key, companyCode, extra = {}) => ({
    id: id(),
    entraObjectId: id(),
    email: `${key}@${companies.find((c) => c.code === companyCode).domain}`,
    companyId: ids[companyCode],
    departmentId: null,
    displayNameEn: `Fake ${key}`,
    displayNameAr: `مستخدم ${key}`,
    jobTitle: null,
    managerId: null,
    officeLocation: null,
    phone: null,
    mobilePhone: null,
    graphDepartment: null,
    graphCompanyName: null,
    staffId: null,
    employmentCategory: null,
    hireDate: null,
    hrFields: null,
    hrImportedAt: null,
    searchKey: `fake ${key}`,
    language: 'en',
    isActive: true,
    lastSyncedAt: at('2026-10-19T00:00:00Z'),
    ...stamps('2026-10-08T08:00:00Z'),
    ...extra,
  });
  const u = {
    admin: person('admin.one', 'HLD'),
    lead1: person('lead.one', 'HLD'),
    lead2: person('lead.two', 'HLD'),
    lead3: person('lead.three', 'GEN'),
    agent: person('agent.one', 'GEN'),
    req1: person('requester.one', 'GEN', {
      departmentId: ids.dept,
      jobTitle: 'Fake Surveyor',
      staffId: 'S100',
      employmentCategory: 'Staff',
      hireDate: at('2020-01-05T00:00:00Z'),
      hrFields: 'departmentId,jobTitle',
      hrImportedAt: at('2026-10-19T09:00:00Z'),
      language: 'ar',
    }),
    req2: person('requester.two', 'MSR'),
    caMsr: person('companyadmin.msr', 'MSR'),
    gone: person('former.staff', 'GEN', { isActive: false }),
  };
  u.req1.managerId = u.lead3.id;
  const users = Object.values(u);
  const role = (user, roleName, scopeCompanyId) => ({
    id: id(),
    userId: user.id,
    role: roleName,
    scopeCompanyId,
    ...stamps('2026-10-08T08:00:00Z'),
  });
  const roles = [
    ...users.map((x) => role(x, 'User', x.companyId)),
    role(u.admin, 'HoldingAdmin', null),
    role(u.caMsr, 'CompanyAdmin', ids.MSR),
  ];

  const team = {
    id: ids.team,
    code: 'IT',
    nameEn: 'IT Helpdesk',
    nameAr: 'الدعم الفني',
    servesAllCompanies: true,
    isActive: true,
    ...stamps('2026-10-19T08:00:00Z'),
  };
  const member = (user, r) => ({
    id: id(),
    teamId: ids.team,
    userId: user.id,
    role: r,
    ...stamps('2026-10-19T08:00:00Z'),
  });
  const members = [
    member(u.lead1, 'Lead'),
    member(u.lead2, 'Lead'),
    member(u.lead3, 'Lead'),
    member(u.agent, 'Agent'),
  ];
  // 09:00 to 17:00, not the default's 08:00: the portal's values must win.
  const calendar = {
    id: id(),
    teamId: ids.team,
    timeZone: 'Africa/Cairo',
    workingDays: '0,1,2,3,4',
    startMin: 540,
    endMin: 1020,
    ...stamps('2026-10-19T08:00:00Z'),
  };
  const sla = ['P1', 'P2', 'P3', 'P4'].map((priority, i) => ({
    id: id(),
    teamId: ids.team,
    priority,
    firstResponseMinutes: 33 + i,
    resolveMinutes: 333 + i,
    ...stamps('2026-10-19T08:00:00Z'),
  }));
  const category = (key, nameEn, extra = {}) => ({
    id: ids[key],
    teamId: ids.team,
    nameEn,
    nameAr: `فئة ${nameEn}`,
    defaultPriority: 'P3',
    sortOrder: 0,
    isActive: true,
    ...stamps('2026-10-19T08:00:00Z'),
    ...extra,
  });
  const categories = [
    category('catLaptop', 'Laptop / PC', { defaultPriority: 'P2' }),
    // A lead renamed the default "Printer / scanner": no default may come back beside it.
    category('catPrinters', 'Printers and scanning', { sortOrder: 1 }),
    category('catOld', 'Old category', { sortOrder: 2, isActive: false }),
  ];
  const locations = [
    {
      id: ids.locHq,
      nameEn: 'Fake HQ',
      nameAr: 'المقر',
      sortOrder: 0,
      isActive: true,
      ...stamps('2026-10-19T08:00:00Z'),
    },
    {
      id: ids.locSite,
      nameEn: 'Fake Mine Site',
      nameAr: 'الموقع',
      sortOrder: 1,
      isActive: true,
      ...stamps('2026-10-19T08:00:00Z'),
    },
  ];
  const holidays = [
    {
      id: id(),
      date: '2026-10-06',
      nameEn: 'Fake Day',
      nameAr: 'يوم',
      ...stamps('2026-10-19T08:00:00Z'),
    },
  ];
  const replies = [
    {
      id: id(),
      teamId: ids.team,
      titleEn: 'We are on it',
      titleAr: 'نعمل عليه',
      bodyEn: 'Body',
      bodyAr: 'نص',
      sortOrder: 0,
      isActive: true,
      ...stamps('2026-10-19T08:00:00Z'),
    },
  ];
  const sequences = [
    { id: id(), prefix: 'IT', year: 2026, last: 7, ...stamps('2026-10-19T08:00:00Z') },
  ];

  const ticket = (key, number, extra) => ({
    id: ids[key],
    number,
    teamId: ids.team,
    locationId: null,
    source: 'portal',
    assigneeId: null,
    description: 'It does not start.',
    priority: 'P3',
    status: 'Open',
    firstResponseDueAt: at('2026-10-20T10:00:00Z'),
    resolveDueAt: at('2026-10-21T10:00:00Z'),
    firstRespondedAt: null,
    resolvedAt: null,
    closedAt: null,
    slaPausedMinutes: 0,
    slaPausedAt: null,
    nextDueAt: at('2026-10-21T10:00:00Z'),
    nextRiskAt: at('2026-10-21T06:00:00Z'),
    slaActive: true,
    closeMode: null,
    closeReason: null,
    rating: null,
    ratingFeedback: null,
    ratedAt: null,
    assetTag: null,
    ...extra,
  });
  const tickets = [
    ticket('T1', 'IT-2026-00005', {
      companyId: ids.GEN,
      categoryId: ids.catLaptop,
      requesterId: u.req1.id,
      createdById: u.req1.id,
      assigneeId: u.agent.id,
      subject: 'Laptop will not start',
      status: 'Closed',
      firstRespondedAt: at('2026-10-19T10:30:00Z'),
      resolvedAt: at('2026-10-19T14:00:00Z'),
      closedAt: at('2026-10-20T09:00:00Z'),
      slaActive: false,
      closeMode: 'confirmed',
      rating: 5,
      ratingFeedback: 'Quick, thank you.',
      ratedAt: at('2026-10-20T09:00:00Z'),
      createdAt: at('2026-10-19T10:00:00Z'),
      updatedAt: at('2026-10-20T09:00:00Z'),
    }),
    ticket('T2', 'IT-2026-00007', {
      companyId: ids.MSR,
      categoryId: ids.catPrinters,
      locationId: ids.locSite,
      requesterId: u.req2.id,
      createdById: u.lead1.id,
      source: 'phone',
      assigneeId: u.lead1.id,
      subject: 'Printer offline at the site',
      status: 'Pending',
      firstRespondedAt: at('2026-10-20T11:00:00Z'),
      slaPausedMinutes: 30,
      slaPausedAt: at('2026-10-21T12:00:00Z'),
      slaActive: false,
      createdAt: at('2026-10-20T10:00:00Z'),
      updatedAt: at('2026-10-21T12:00:00Z'),
    }),
    ticket('T3', 'IT-2025-00012', {
      companyId: ids.HLD,
      categoryId: ids.catOld,
      requesterId: u.admin.id,
      createdById: u.admin.id,
      subject: 'Old request from last year',
      status: 'Closed',
      resolvedAt: at('2025-12-20T10:00:00Z'),
      closedAt: at('2025-12-28T10:00:00Z'),
      slaActive: false,
      closeMode: 'lead',
      closeReason: 'The requester left the company.',
      createdAt: at('2025-12-14T10:00:00Z'),
      updatedAt: at('2025-12-28T10:00:00Z'),
    }),
  ];
  const comments = [
    {
      id: ids.C1,
      ticketId: ids.T1,
      authorId: u.agent.id,
      body: 'Please hold the power button.',
      isInternal: false,
      ...stamps('2026-10-19T10:30:00Z'),
    },
    {
      id: ids.C2,
      ticketId: ids.T1,
      authorId: u.lead1.id,
      body: 'Battery is swollen, replace it.',
      isInternal: true,
      ...stamps('2026-10-19T11:00:00Z'),
    },
    {
      id: ids.C3,
      ticketId: ids.T2,
      authorId: u.req2.id,
      body: 'It shows a red light.',
      isInternal: false,
      ...stamps('2026-10-20T12:00:00Z'),
    },
  ];
  const attachment = (key, ticketId, extra) => ({
    id: key,
    ticketId,
    commentId: null,
    uploadedById: u.req1.id,
    fileName: `${key}.png`,
    contentType: 'image/png',
    size: 0,
    storageKey: `ticket-${key}.png`,
    isInternal: false,
    ...stamps('2026-10-19T10:05:00Z'),
    ...extra,
  });
  const files = new Map([
    ['ticket-a1.png', Buffer.from('fake image one')],
    ['ticket-a2.png', Buffer.from('fake internal photo')],
    ['ticket-a4.png', Buffer.from('fake file without a verdict row')],
  ]);
  const attachments = [
    attachment('a1', ids.T1, { size: files.get('ticket-a1.png').length }),
    attachment('a2', ids.T1, {
      commentId: ids.C2,
      uploadedById: u.lead1.id,
      isInternal: true,
      size: files.get('ticket-a2.png').length,
    }),
    // Blocked as infected: the portal deleted its bytes.
    attachment('a3', ids.T2, { uploadedById: u.req2.id, size: 68 }),
    attachment('a4', ids.T2, {
      uploadedById: u.req2.id,
      size: files.get('ticket-a4.png').length,
    }),
  ].map((a) => ({ ...a, id: id(), key: a.id }));
  const scan = (key, state, link) => ({
    storageKey: `ticket-${key}.png`,
    state,
    uploadedById: u.req1.id,
    fileName: `${key}.png`,
    link,
    scannedAt: state === 'pending' ? null : at('2026-10-19T10:06:00Z'),
    ...stamps('2026-10-19T10:05:00Z'),
  });
  const scans = [
    scan('a1', 'clean', `#tickets/${ids.T1}`),
    scan('a2', 'pending', `/helpdesk#tickets/${ids.T1}`),
    scan('a3', 'infected', `#tickets/${ids.T2}`),
    // a4 has no verdict row at all.
  ];
  const event = (ticketId, type, extra = {}) => ({
    id: id(),
    ticketId,
    actorId: null,
    type,
    fromValue: null,
    toValue: null,
    commentId: null,
    isInternal: false,
    ...stamps('2026-10-19T10:00:00Z'),
    ...extra,
  });
  const events = [
    event(ids.T1, 'created', { actorId: u.req1.id }),
    event(ids.T1, 'status', { actorId: u.agent.id, fromValue: 'Open', toValue: 'Resolved' }),
    event(ids.T1, 'confirmed', { actorId: u.req1.id }),
    event(ids.T2, 'status', { actorId: u.lead1.id, fromValue: 'Open', toValue: 'Pending' }),
    event(ids.T3, 'closedByLead', { actorId: u.lead1.id }),
  ];
  const note = (user, templateKey, extra = {}) => ({
    id: id(),
    userId: user.id,
    companyId: user.companyId,
    channel: 'inApp',
    templateKey,
    payload: JSON.stringify({ link: `#tickets/${ids.T1}`, vars: { number: 'IT-2026-00005' } }),
    dedupeKey: null,
    readAt: null,
    sentAt: at('2026-10-19T10:31:00Z'),
    ...stamps('2026-10-19T10:31:00Z'),
    ...extra,
  });
  const notifications = [
    note(u.req1, 'ticket.comment'), // unread: copied
    note(u.lead1, 'ticket.assigned', {
      payload: JSON.stringify({ link: `/helpdesk#tickets/${ids.T2}`, vars: {} }),
    }), // unread, IT's link: copied as "#tickets/<id>"
    note(u.req1, 'ticket.status', { readAt: at('2026-10-19T12:00:00Z') }), // read: left behind
    note(u.lead1, 'ticket.slaAtRisk', {
      dedupeKey: `sla:${ids.T2}:resolve:75`,
      readAt: at('2026-10-21T08:00:00Z'),
    }), // read but keyed: copied, so the alert is never sent again
    note(u.lead1, 'ticket.slaAtRisk', {
      channel: 'email',
      dedupeKey: `sla:${ids.T2}:resolve:75`,
    }),
    note(u.req2, 'booking.confirmed'), // not a ticket's
  ];
  const preferences = [
    {
      id: id(),
      userId: u.req1.id,
      companyId: ids.GEN,
      category: 'tickets',
      channel: 'email',
      enabled: false,
      ...stamps('2026-10-19T08:00:00Z'),
    },
    {
      id: id(),
      userId: u.req1.id,
      companyId: ids.GEN,
      category: 'bookings',
      channel: 'inApp',
      enabled: false,
      ...stamps('2026-10-19T08:00:00Z'),
    },
  ];
  const audit = [
    {
      id: id(),
      at: at('2026-10-19T10:00:00Z'),
      actorId: u.req1.id,
      companyId: ids.GEN,
      action: 'ticket.created',
      entity: 'Ticket',
      entityId: ids.T1,
      before: null,
      after: '{}',
      ip: '10.0.0.1',
      ...stamps('2026-10-19T10:00:00Z'),
    },
    {
      id: id(),
      at: at('2026-10-19T09:00:00Z'),
      actorId: u.lead1.id,
      companyId: null,
      action: 'helpdesk.sla.update',
      entity: 'SlaPolicy',
      entityId: sla[0].id,
      before: '{}',
      after: '{}',
      ip: null,
      ...stamps('2026-10-19T09:00:00Z'),
    },
    {
      id: id(),
      at: at('2026-10-19T09:30:00Z'),
      actorId: u.admin.id,
      companyId: ids.GEN,
      action: 'company.update',
      entity: 'Company',
      entityId: ids.GEN,
      before: '{}',
      after: '{}',
      ip: null,
      ...stamps('2026-10-19T09:30:00Z'),
    },
  ];
  const leases = [
    {
      name: 'sla-watch',
      lockedUntil: at('2026-10-19T10:05:00Z'),
      holder: 'portal',
      lastStartedAt: at('2026-10-19T10:00:00Z'),
      lastFinishedAt: null,
      lastResult: 'ok',
      ...stamps('2026-10-19T10:00:00Z'),
    },
  ];

  const tables = {
    company: companies,
    companyDomain: domains,
    department: [
      {
        id: ids.dept,
        companyId: ids.GEN,
        nameEn: 'Information Technology',
        nameAr: 'تقنية المعلومات',
        isActive: true,
        ...stamps('2026-10-19T08:00:00Z'),
      },
    ],
    userProfile: users,
    roleAssignment: roles,
    supportTeam: [team],
    supportTeamCompany: [],
    supportTeamMember: members,
    businessCalendar: [calendar],
    slaPolicy: sla,
    ticketCategory: categories,
    ticketLocation: locations,
    holiday: holidays,
    cannedReply: replies,
    ticketSequence: sequences,
    ticket: tickets,
    ticketComment: comments,
    ticketAttachment: attachments.map(({ key: _key, ...a }) => a),
    fileScan: scans,
    ticketEvent: events,
    notification: notifications,
    notificationPreference: preferences,
    auditLog: audit,
    jobLease: leases,
  };
  return { tables, ids, users: u, files, attachments };
}
