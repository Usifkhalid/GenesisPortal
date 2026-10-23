import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  DEFENDER_TAG,
  SCAN,
  createDefenderScanner,
  createMemoryScanStore,
  createMockScanner,
  createScannedStorage,
} from '@mg/shared/server/lib/file-scan.js';
import { createAzureBlobStorage } from '@mg/shared/server/lib/storage-azure.js';
import { createMemoryStorage } from '@mg/shared/server/lib/storage.js';

/**
 * Uploads are not handed out until scanned and clean (lib/file-scan.js), and
 * the Azure Blob adapter behaves like the local one (lib/storage-azure.js,
 * against a stand-in for the container: no Azure account in this project yet).
 */

const EICAR = Buffer.from(
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
  'latin1'
);
const TEXT = Buffer.from('printer log\nline two\n');
const quiet = { warn() {}, info() {} };

/** A memory storage that also holds index tags, as a blob container does. */
function taggedStorage() {
  const storage = createMemoryStorage();
  const tags = new Map();
  return {
    ...storage,
    tagMap: tags,
    tags: async (key) => tags.get(key) ?? {},
    verdict: (key, value) => tags.set(key, { [DEFENDER_TAG]: value }),
  };
}

function scanned({
  scanner = createMockScanner(),
  storage = createMemoryStorage(),
  leads = [],
} = {}) {
  const told = [];
  const scans = createMemoryScanStore({
    helpdesk: {
      team: [{ id: 't1', isActive: true }],
      member: leads.map((userId) => ({ teamId: 't1', userId, role: 'Lead' })),
    },
  });
  const files = createScannedStorage({
    storage,
    scans,
    scanner,
    notify: async (to, template, data) => told.push({ to, template, data }),
    log: quiet,
  });
  return { files, scans, storage, told };
}

describe('scanned storage', () => {
  test('a clean file is stored, marked clean and read back', async () => {
    const { files, scans } = scanned();
    assert.equal(await files.put('a.txt', TEXT, { uploadedById: 'u1' }), SCAN.CLEAN);
    assert.equal((await scans.get('a.txt')).state, SCAN.CLEAN);
    assert.deepEqual(await files.get('a.txt'), TEXT);
  });

  test('a pending file cannot be read: 409 until its verdict arrives', async () => {
    const storage = taggedStorage();
    const { files, scans } = scanned({ scanner: createDefenderScanner(), storage });

    assert.equal(await files.put('doc.pdf', TEXT, { uploadedById: 'u1' }), SCAN.PENDING);
    assert.ok(storage.files.has('doc.pdf'), 'the bytes are stored, for the scanner to read');
    await assert.rejects(
      () => files.get('doc.pdf'),
      (err) => err.status === 409 && err.code === 'file_scan_pending'
    );
    assert.equal((await files.states(['doc.pdf'])).get('doc.pdf'), SCAN.PENDING);

    // Defender writes its verdict on the blob; the next read picks it up.
    storage.verdict('doc.pdf', 'No threats found');
    assert.deepEqual(await files.get('doc.pdf'), TEXT);
    assert.equal((await scans.get('doc.pdf')).state, SCAN.CLEAN);
  });

  test('an infected file is blocked, deleted, and the uploader and IT leads told once', async () => {
    const storage = taggedStorage();
    const { files, scans, told } = scanned({
      scanner: createDefenderScanner(),
      storage,
      leads: ['lead-1', 'lead-2'],
    });
    await files.put('bad.docx', TEXT, {
      uploadedById: 'u1',
      fileName: 'invoice.docx',
      link: '#tickets/42',
    });
    storage.verdict('bad.docx', 'Malicious');

    const result = await files.sweep();
    assert.deepEqual(result, { clean: 0, infected: 1, pending: 0 });
    assert.equal((await scans.get('bad.docx')).state, SCAN.INFECTED);
    assert.equal(storage.files.has('bad.docx'), false, 'the bytes are gone');
    await assert.rejects(
      () => files.get('bad.docx'),
      (err) => err.status === 410 && err.code === 'file_blocked'
    );

    assert.equal(told.length, 1);
    assert.deepEqual(told[0].to, ['u1', 'lead-1', 'lead-2']);
    assert.equal(told[0].template, 'file.infected');
    assert.equal(told[0].data.fileName, 'invoice.docx');
    assert.equal(told[0].data.link, '#tickets/42');
    assert.ok(told[0].data.dedupeKey.includes('bad.docx'));

    // Asked again (a second instance, a later sweep): nobody is told twice.
    await files.sweep();
    await assert.rejects(() => files.get('bad.docx'));
    assert.equal(told.length, 1);
  });

  test('a file with no verdict on record is never served on trust', async () => {
    const storage = taggedStorage();
    const { files, scans } = scanned({ scanner: createDefenderScanner(), storage });
    // Bytes that reached the container some other way.
    await storage.put('stray.png', TEXT);
    await assert.rejects(
      () => files.get('stray.png'),
      (err) => err.status === 409
    );
    assert.equal((await scans.get('stray.png')).state, SCAN.PENDING);
    assert.equal((await files.states(['unknown.png'])).get('unknown.png'), SCAN.PENDING);
  });

  test('a scan Defender could not finish stays blocked', async () => {
    const storage = taggedStorage();
    const { files } = scanned({ scanner: createDefenderScanner(), storage });
    await files.put('odd.pdf', TEXT);
    for (const value of ['Error', 'Not scanned', '']) {
      storage.verdict('odd.pdf', value);
      await assert.rejects(
        () => files.get('odd.pdf'),
        (err) => err.status === 409,
        value
      );
    }
  });

  test('uploading again under a key resets its verdict; removing forgets it', async () => {
    const { files, scans } = scanned();
    await files.put('k.txt', TEXT);
    await files.remove('k.txt');
    assert.equal(await scans.get('k.txt'), null);
    assert.equal(await files.put('k.txt', EICAR), SCAN.INFECTED);
    await assert.rejects(
      () => files.get('k.txt'),
      (err) => err.status === 410
    );
  });

  test('the mock scanner passes ordinary files and catches the EICAR test file', async () => {
    const scanner = createMockScanner();
    assert.equal(await scanner.scan('a', TEXT), SCAN.CLEAN);
    assert.equal(await scanner.scan('b', EICAR), SCAN.INFECTED);
    assert.equal(await scanner.scan('c', Buffer.concat([TEXT, EICAR, TEXT])), SCAN.INFECTED);
  });
});

describe('Azure Blob adapter', () => {
  /** What the adapter uses of @azure/storage-blob's ContainerClient. */
  function fakeContainer({ exists = true } = {}) {
    const blobs = new Map();
    const tags = new Map();
    const notFound = () => Object.assign(new Error('BlobNotFound'), { statusCode: 404 });
    return {
      blobs,
      tags,
      exists: async () => exists,
      getBlockBlobClient: (name) => ({
        uploadData: async (buffer) => void blobs.set(name, Buffer.from(buffer)),
        downloadToBuffer: async () => {
          if (!blobs.has(name)) throw notFound();
          return blobs.get(name);
        },
        deleteIfExists: async () => ({ succeeded: blobs.delete(name) }),
        getTags: async () => {
          if (!blobs.has(name)) throw notFound();
          return { tags: tags.get(name) ?? {} };
        },
      }),
    };
  }

  test('puts, gets, removes and reads tags like the local adapter', async () => {
    const container = fakeContainer();
    const storage = createAzureBlobStorage({}, container);

    await storage.put('logo-1.png', TEXT);
    assert.deepEqual(await storage.get('logo-1.png'), TEXT);
    assert.equal(await storage.get('missing.png'), null);
    assert.deepEqual(await storage.tags('missing.png'), {});

    container.tags.set('logo-1.png', { [DEFENDER_TAG]: 'No threats found' });
    assert.equal((await storage.tags('logo-1.png'))[DEFENDER_TAG], 'No threats found');

    await storage.remove('logo-1.png');
    await storage.remove('logo-1.png');
    assert.equal(await storage.get('logo-1.png'), null);
    await storage.check();
  });

  test('a key that could leave the container is refused before any call', async () => {
    const storage = createAzureBlobStorage({}, fakeContainer());
    for (const key of ['../x', 'a/b', '', 'A.png', '.hidden', 'x..y']) {
      await assert.rejects(() => storage.put(key, TEXT), /Invalid storage key/, key);
      await assert.rejects(() => storage.get(key), /Invalid storage key/, key);
    }
  });

  test('a missing container fails the readiness check; other errors are not swallowed', async () => {
    await assert.rejects(() =>
      createAzureBlobStorage({}, fakeContainer({ exists: false })).check()
    );
    const broken = {
      getBlockBlobClient: () => ({
        downloadToBuffer: async () => {
          throw Object.assign(new Error('AuthorizationFailure'), { statusCode: 403 });
        },
      }),
    };
    await assert.rejects(
      () => createAzureBlobStorage({}, broken).get('a.png'),
      /Authorization/
    );
  });

  test('with Defender, the whole path works over the adapter', async () => {
    const container = fakeContainer();
    const { files } = scanned({
      scanner: createDefenderScanner(),
      storage: createAzureBlobStorage({}, container),
    });
    await files.put('cover-1.png', TEXT);
    await assert.rejects(
      () => files.get('cover-1.png'),
      (err) => err.status === 409
    );
    container.tags.set('cover-1.png', { [DEFENDER_TAG]: 'No threats found' });
    assert.deepEqual(await files.get('cover-1.png'), TEXT);
  });
});
