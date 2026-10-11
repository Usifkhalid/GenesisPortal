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
 * Twelve people: one HoldingAdmin, one CompanyAdmin per company, eight Users.
 * `manager` is another user's email. Phone numbers use an unassigned prefix.
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

/** A stable, obviously fake Entra object id for the nth seeded user. */
export function fakeEntraObjectId(index) {
  return `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
}
