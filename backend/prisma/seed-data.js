/**
 * seed-data.js — the development data set, as plain values with no database
 * in sight, so it can be tested on its own and read by AUTH_MODE=mock.
 *
 * The three companies are real; every person is invented. Records refer to
 * each other by natural key (company code, department key, email) and seed.js
 * turns those into ids.
 */

import { ROLES } from '../src/lib/roles.js';

export const COMPANIES = [
  {
    code: 'HLD',
    nameEn: 'MG Holding',
    nameAr: 'إم جي هولدنج',
    // Placeholder: the holding's real mail domain has not been supplied.
    domain: 'mgholding.example',
    accentColor: '#b4552d',
    logoUrl: null,
  },
  {
    code: 'GEN',
    nameEn: 'Genesis Mining',
    nameAr: 'جينيسيس للتعدين',
    domain: 'genesismining-eg.com',
    accentColor: '#1c7a4a',
    logoUrl: 'assets/img/companies/gen.svg',
  },
  {
    code: 'MSR',
    nameEn: 'Masar',
    nameAr: 'مسار',
    domain: 'masar.eg',
    accentColor: '#1e5aa8',
    logoUrl: 'assets/img/companies/msr.png',
  },
];

export const DEPARTMENTS = [
  { company: 'HLD', key: 'finance', nameEn: 'Finance', nameAr: 'المالية' },
  { company: 'HLD', key: 'hr', nameEn: 'Human Resources', nameAr: 'الموارد البشرية' },
  { company: 'HLD', key: 'it', nameEn: 'Information Technology', nameAr: 'تقنية المعلومات' },

  { company: 'GEN', key: 'operations', nameEn: 'Mining Operations', nameAr: 'عمليات التعدين' },
  {
    company: 'GEN',
    key: 'geology',
    nameEn: 'Geology and Exploration',
    nameAr: 'الجيولوجيا والاستكشاف',
  },
  {
    company: 'GEN',
    key: 'hse',
    nameEn: 'Health, Safety and Environment',
    nameAr: 'الصحة والسلامة والبيئة',
  },

  { company: 'MSR', key: 'projects', nameEn: 'Projects', nameAr: 'المشاريع' },
  { company: 'MSR', key: 'engineering', nameEn: 'Engineering', nameAr: 'الهندسة' },
  { company: 'MSR', key: 'procurement', nameEn: 'Procurement', nameAr: 'المشتريات' },
];

const HQ = 'Cairo HQ';

/**
 * Fourteen people: one HoldingAdmin, one CompanyAdmin per company, ten Users.
 * `manager` is another user's email. Phone numbers use an unassigned prefix.
 * The last two are the IT helpdesk's agents: they are also in the mocked
 * Graph (backend/mock/graph-users.json), so they carry the ids it gives them.
 */
export const USERS = [
  // MG Holding
  {
    email: 'nadia.elsayed@mgholding.example',
    company: 'HLD',
    department: 'it',
    displayNameEn: 'Nadia El-Sayed',
    displayNameAr: 'نادية السيد',
    jobTitle: 'Group IT Director',
    manager: null,
    officeLocation: HQ,
    phone: '+20 2 5550 0101',
    language: 'en',
    role: ROLES.HOLDING_ADMIN,
  },
  {
    email: 'karim.mansour@mgholding.example',
    company: 'HLD',
    department: 'hr',
    displayNameEn: 'Karim Mansour',
    displayNameAr: 'كريم منصور',
    jobTitle: 'HR Manager',
    manager: 'nadia.elsayed@mgholding.example',
    officeLocation: HQ,
    phone: '+20 2 5550 0102',
    language: 'ar',
    role: ROLES.COMPANY_ADMIN,
  },
  {
    email: 'mona.abdelrahman@mgholding.example',
    company: 'HLD',
    department: 'finance',
    displayNameEn: 'Mona Abdel Rahman',
    displayNameAr: 'منى عبد الرحمن',
    jobTitle: 'Senior Accountant',
    manager: 'karim.mansour@mgholding.example',
    officeLocation: HQ,
    phone: '+20 2 5550 0103',
    language: 'ar',
    role: ROLES.USER,
  },
  {
    email: 'omar.fahmy@mgholding.example',
    company: 'HLD',
    department: 'it',
    displayNameEn: 'Omar Fahmy',
    displayNameAr: 'عمر فهمي',
    jobTitle: 'Systems Administrator',
    manager: 'nadia.elsayed@mgholding.example',
    officeLocation: HQ,
    phone: '+20 2 5550 0104',
    language: 'en',
    role: ROLES.USER,
  },

  // Genesis Mining
  {
    email: 'hany.soliman@genesismining-eg.com',
    company: 'GEN',
    department: 'operations',
    displayNameEn: 'Hany Soliman',
    displayNameAr: 'هاني سليمان',
    jobTitle: 'Operations Manager',
    manager: null,
    officeLocation: HQ,
    phone: '+20 2 5550 0201',
    language: 'ar',
    role: ROLES.COMPANY_ADMIN,
  },
  {
    email: 'salma.ibrahim@genesismining-eg.com',
    company: 'GEN',
    department: 'geology',
    displayNameEn: 'Salma Ibrahim',
    displayNameAr: 'سلمى إبراهيم',
    jobTitle: 'Senior Geologist',
    manager: 'hany.soliman@genesismining-eg.com',
    officeLocation: 'Eastern Desert Mine Site',
    phone: '+20 2 5550 0202',
    language: 'en',
    role: ROLES.USER,
  },
  {
    email: 'mahmoud.attia@genesismining-eg.com',
    company: 'GEN',
    department: 'operations',
    displayNameEn: 'Mahmoud Attia',
    displayNameAr: 'محمود عطية',
    jobTitle: 'Shift Supervisor',
    manager: 'hany.soliman@genesismining-eg.com',
    officeLocation: 'Eastern Desert Mine Site',
    phone: '+20 2 5550 0203',
    language: 'ar',
    role: ROLES.USER,
  },
  {
    email: 'dina.khalil@genesismining-eg.com',
    company: 'GEN',
    department: 'hse',
    displayNameEn: 'Dina Khalil',
    displayNameAr: 'دينا خليل',
    jobTitle: 'HSE Officer',
    manager: 'hany.soliman@genesismining-eg.com',
    officeLocation: 'Eastern Desert Mine Site',
    phone: '+20 2 5550 0204',
    language: 'ar',
    role: ROLES.USER,
  },

  // Masar
  {
    email: 'tarek.elmasry@masar.eg',
    company: 'MSR',
    department: 'projects',
    displayNameEn: 'Tarek El-Masry',
    displayNameAr: 'طارق المصري',
    jobTitle: 'Projects Director',
    manager: null,
    officeLocation: HQ,
    phone: '+20 2 5550 0301',
    language: 'en',
    role: ROLES.COMPANY_ADMIN,
  },
  {
    email: 'yasmine.nabil@masar.eg',
    company: 'MSR',
    department: 'engineering',
    displayNameEn: 'Yasmine Nabil',
    displayNameAr: 'ياسمين نبيل',
    jobTitle: 'Civil Engineer',
    manager: 'tarek.elmasry@masar.eg',
    officeLocation: 'New Capital Site Office',
    phone: '+20 2 5550 0302',
    language: 'ar',
    role: ROLES.USER,
  },
  {
    email: 'ahmed.shawky@masar.eg',
    company: 'MSR',
    department: 'projects',
    displayNameEn: 'Ahmed Shawky',
    displayNameAr: 'أحمد شوقي',
    jobTitle: 'Site Manager',
    manager: 'tarek.elmasry@masar.eg',
    officeLocation: 'New Capital Site Office',
    phone: '+20 2 5550 0303',
    language: 'ar',
    role: ROLES.USER,
  },
  {
    email: 'rania.farouk@masar.eg',
    company: 'MSR',
    department: 'procurement',
    displayNameEn: 'Rania Farouk',
    displayNameAr: 'رانيا فاروق',
    jobTitle: 'Procurement Specialist',
    manager: 'tarek.elmasry@masar.eg',
    officeLocation: HQ,
    phone: '+20 2 5550 0304',
    language: 'en',
    role: ROLES.USER,
  },

  // The IT helpdesk's agents (MG Holding). Last, so the ids of the twelve
  // above stay what the mocked Graph gives them.
  {
    email: 'sherif.awad@mgholding.example',
    entraObjectId: '00000000-0000-4000-9000-000000000003',
    company: 'HLD',
    department: 'it',
    displayNameEn: 'Sherif Awad',
    displayNameAr: 'شريف عوض',
    jobTitle: 'Network Engineer',
    manager: 'nadia.elsayed@mgholding.example',
    officeLocation: HQ,
    phone: '+20 2 5550 1003',
    language: 'en',
    role: ROLES.USER,
  },
  {
    email: 'tamer.gad@mgholding.example',
    entraObjectId: '00000000-0000-4000-9000-000000000008',
    company: 'HLD',
    department: 'it',
    displayNameEn: 'Tamer Gad',
    displayNameAr: 'تامر جاد',
    jobTitle: 'Helpdesk Analyst',
    manager: 'nadia.elsayed@mgholding.example',
    officeLocation: HQ,
    phone: '+20 2 5550 1008',
    language: 'ar',
    role: ROLES.USER,
  },
];

/**
 * Six meeting rooms at Cairo HQ, open to every company. Names, floors and
 * mailboxes are placeholders until the real rooms are supplied; the mocked
 * Graph lists the same six as Exchange room mailboxes.
 * Equipment: screen, videoConference, whiteboard, phone, other.
 */
export const ROOMS = [
  {
    mailboxEmail: 'room-hq-1@mgholding.example',
    nameEn: 'Meeting Room 1',
    nameAr: 'قاعة الاجتماعات 1',
    floor: '1',
    capacity: 4,
    equipment: ['screen', 'whiteboard'],
  },
  {
    mailboxEmail: 'room-hq-2@mgholding.example',
    nameEn: 'Meeting Room 2',
    nameAr: 'قاعة الاجتماعات 2',
    floor: '1',
    capacity: 6,
    equipment: ['screen', 'videoConference'],
  },
  {
    mailboxEmail: 'room-hq-3@mgholding.example',
    nameEn: 'Meeting Room 3',
    nameAr: 'قاعة الاجتماعات 3',
    floor: '2',
    capacity: 8,
    equipment: ['screen', 'videoConference', 'whiteboard'],
  },
  {
    mailboxEmail: 'room-hq-4@mgholding.example',
    nameEn: 'Meeting Room 4',
    nameAr: 'قاعة الاجتماعات 4',
    floor: '2',
    capacity: 10,
    equipment: ['screen', 'videoConference', 'phone'],
  },
  {
    mailboxEmail: 'room-hq-5@mgholding.example',
    nameEn: 'Boardroom',
    nameAr: 'قاعة مجلس الإدارة',
    floor: '3',
    capacity: 16,
    equipment: ['screen', 'videoConference', 'whiteboard', 'phone'],
  },
  {
    mailboxEmail: 'room-hq-6@mgholding.example',
    nameEn: 'Training Room',
    nameAr: 'قاعة التدريب',
    floor: '3',
    capacity: 24,
    equipment: ['screen', 'whiteboard', 'other'],
  },
];

/* ---------------------------------------------------------------- helpdesk */

/** Priorities, most urgent first. The keys are what Ticket.priority stores. */
export const PRIORITIES = ['P1', 'P2', 'P3', 'P4'];

/**
 * One support team: IT, serving every company from one queue. Another
 * department is another entry here (or a row made in the admin screens), with
 * its own categories, targets and hours.
 *
 * SLA targets are business minutes: P1 Urgent 1 h / 4 h, P2 High 4 h / 8 h,
 * P3 Normal 8 h / 24 h, P4 Low 16 h / 40 h. Hours are Sunday to Thursday,
 * 08:00 to 17:00 on Cairo's clock.
 */
export const SUPPORT_TEAMS = [
  {
    code: 'IT',
    nameEn: 'IT Support',
    nameAr: 'الدعم الفني',
    servesAllCompanies: true,
    members: [
      { email: 'omar.fahmy@mgholding.example', role: 'Lead' },
      { email: 'sherif.awad@mgholding.example', role: 'Agent' },
      { email: 'tamer.gad@mgholding.example', role: 'Agent' },
    ],
    calendar: {
      timeZone: 'Africa/Cairo',
      workingDays: '0,1,2,3,4',
      startMin: 480,
      endMin: 1020,
    },
    sla: [
      { priority: 'P1', firstResponseMinutes: 60, resolveMinutes: 240 },
      { priority: 'P2', firstResponseMinutes: 240, resolveMinutes: 480 },
      { priority: 'P3', firstResponseMinutes: 480, resolveMinutes: 1440 },
      { priority: 'P4', firstResponseMinutes: 960, resolveMinutes: 2400 },
    ],
    categories: [
      { nameEn: 'Laptop / PC', nameAr: 'حاسوب محمول / مكتبي', defaultPriority: 'P3' },
      { nameEn: 'Printer / scanner', nameAr: 'طابعة / ماسح ضوئي', defaultPriority: 'P3' },
      { nameEn: 'Email & Teams', nameAr: 'البريد الإلكتروني وTeams', defaultPriority: 'P2' },
      {
        nameEn: 'Accounts & passwords',
        nameAr: 'الحسابات وكلمات المرور',
        defaultPriority: 'P2',
      },
      {
        nameEn: 'Network / Wi-Fi / VPN',
        nameAr: 'الشبكة / Wi-Fi / VPN',
        defaultPriority: 'P2',
      },
      { nameEn: 'Software & installs', nameAr: 'البرامج والتثبيت', defaultPriority: 'P3' },
      { nameEn: 'Phone', nameAr: 'الهاتف', defaultPriority: 'P3' },
      { nameEn: 'New equipment request', nameAr: 'طلب أجهزة جديدة', defaultPriority: 'P4' },
      { nameEn: 'Other', nameAr: 'أخرى', defaultPriority: 'P3' },
    ],
    cannedReplies: [
      {
        titleEn: 'Password reset steps',
        titleAr: 'خطوات إعادة تعيين كلمة المرور',
        bodyEn:
          'Your password has been reset. Sign in with the temporary password we sent to your manager, and you will be asked to choose a new one. It must be at least 12 characters and different from your last five. If the sign-in still fails, reply here.',
        bodyAr:
          'تمت إعادة تعيين كلمة المرور. سجّل الدخول بكلمة المرور المؤقتة التي أرسلناها إلى مديرك، وسيُطلب منك اختيار كلمة جديدة. يجب ألا تقل عن 12 حرفًا وأن تختلف عن آخر خمس كلمات استخدمتها. إذا تعذّر الدخول بعد ذلك فاكتب لنا هنا.',
      },
      {
        titleEn: 'Printer driver install',
        titleAr: 'تثبيت تعريف الطابعة',
        bodyEn:
          'To add the printer: open Settings, then Bluetooth & devices, then Printers & scanners, and choose Add device. Pick the printer for your floor from the list and wait for the driver to install. Print a test page and tell us here if it does not come out.',
        bodyAr:
          'لإضافة الطابعة: افتح الإعدادات، ثم البلوتوث والأجهزة، ثم الطابعات والماسحات الضوئية، واختر إضافة جهاز. اختر طابعة طابقك من القائمة وانتظر حتى يكتمل تثبيت التعريف. اطبع صفحة تجريبية وأخبرنا هنا إذا لم تُطبع.',
      },
      {
        titleEn: 'VPN setup',
        titleAr: 'إعداد VPN',
        bodyEn:
          'The VPN client is now assigned to your laptop. Restart it, open the VPN client from the Start menu and sign in with your work email. Approve the sign-in on your phone. Connect before opening shared drives when you are outside the office or on site.',
        bodyAr:
          'تم تخصيص برنامج VPN لحاسوبك. أعد تشغيله، ثم افتح برنامج VPN من قائمة ابدأ وسجّل الدخول ببريد العمل، ووافق على تسجيل الدخول من هاتفك. اتصل به قبل فتح المجلدات المشتركة عندما تكون خارج المكتب أو في الموقع.',
      },
      {
        titleEn: 'Laptop ready for collection',
        titleAr: 'الحاسوب جاهز للاستلام',
        bodyEn:
          'Your laptop is ready. You can collect it from the IT office at HQ on any working day between 09:00 and 16:00. Please bring your staff ID. If you are on site, reply here and we will send it with the next transfer.',
        bodyAr:
          'حاسوبك جاهز. يمكنك استلامه من مكتب تقنية المعلومات في المقر الرئيسي في أي يوم عمل بين 09:00 و16:00. يُرجى إحضار بطاقة الموظف. إذا كنت في الموقع فاكتب لنا هنا وسنرسله مع أقرب نقل.',
      },
    ],
  },
];

/** Where a problem is. Group-wide; a ticket defaults to the requester's own. */
export const TICKET_LOCATIONS = [
  { nameEn: 'HQ Cairo', nameAr: 'المقر الرئيسي بالقاهرة' },
  { nameEn: 'Sebaiya site', nameAr: 'موقع السباعية' },
  { nameEn: 'Dakhla site', nameAr: 'موقع الداخلة' },
  { nameEn: 'Masar project site', nameAr: 'موقع مشروع مسار' },
  { nameEn: 'Remote / other', nameAr: 'عن بُعد / أخرى' },
];

/**
 * Examples of Egyptian public holidays for 2026 and 2027, for the SLA clock.
 * The fixed dates are right; the Islamic ones follow the moon and are
 * estimates, and the government often moves a holiday to the nearest
 * Thursday or Sunday. Administrators correct the list each year.
 */
export const HOLIDAYS = [
  { date: '2026-01-07', nameEn: 'Coptic Christmas', nameAr: 'عيد الميلاد المجيد' },
  { date: '2026-01-25', nameEn: 'Revolution and Police Day', nameAr: 'عيد الثورة والشرطة' },
  { date: '2026-03-20', nameEn: 'Eid al-Fitr (estimate)', nameAr: 'عيد الفطر (تقديري)' },
  { date: '2026-04-13', nameEn: 'Sham El-Nessim', nameAr: 'شم النسيم' },
  { date: '2026-04-25', nameEn: 'Sinai Liberation Day', nameAr: 'عيد تحرير سيناء' },
  { date: '2026-05-01', nameEn: 'Labour Day', nameAr: 'عيد العمال' },
  { date: '2026-05-27', nameEn: 'Eid al-Adha (estimate)', nameAr: 'عيد الأضحى (تقديري)' },
  { date: '2026-06-30', nameEn: '30 June Revolution', nameAr: 'ثورة 30 يونيو' },
  { date: '2026-07-23', nameEn: '23 July Revolution', nameAr: 'ثورة 23 يوليو' },
  { date: '2026-10-06', nameEn: 'Armed Forces Day', nameAr: 'عيد القوات المسلحة' },
  { date: '2027-01-07', nameEn: 'Coptic Christmas', nameAr: 'عيد الميلاد المجيد' },
  { date: '2027-01-25', nameEn: 'Revolution and Police Day', nameAr: 'عيد الثورة والشرطة' },
  { date: '2027-04-25', nameEn: 'Sinai Liberation Day', nameAr: 'عيد تحرير سيناء' },
  { date: '2027-05-03', nameEn: 'Sham El-Nessim', nameAr: 'شم النسيم' },
  { date: '2027-10-06', nameEn: 'Armed Forces Day', nameAr: 'عيد القوات المسلحة' },
];

/** A stable, obviously fake Entra object id for the nth seeded user. */
export function fakeEntraObjectId(index) {
  return `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
}
