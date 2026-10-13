/**
 * storage-azure.js — the storage adapter over one private Azure Blob
 * container (STORAGE_DRIVER=azure). Same methods as the local adapter in
 * storage.js, plus `tags`, which the Defender scanner reads its verdict from.
 *
 * The container has no public access and no SAS links are ever made: the only
 * way to a file is a route of this app that has checked the session and the
 * record the file belongs to. The app reaches the account with its managed
 * identity (AZURE_STORAGE_ACCOUNT_URL); a connection string is accepted
 * instead for Azurite on a developer's machine.
 *
 * The SDK is imported on first use, so nothing loads it in local mode.
 *
 * NOT YET RUN AGAINST AZURE (no subscription access in this project yet). The
 * adapter is covered by tests with a stand-in for the container client.
 */

import { assertKey } from './storage.js';

async function createContainerClient(config) {
  const { BlobServiceClient } = await import('@azure/storage-blob');
  let service;
  if (config.AZURE_STORAGE_CONNECTION_STRING) {
    service = BlobServiceClient.fromConnectionString(config.AZURE_STORAGE_CONNECTION_STRING);
  } else {
    const { DefaultAzureCredential } = await import('@azure/identity');
    service = new BlobServiceClient(
      config.AZURE_STORAGE_ACCOUNT_URL,
      new DefaultAzureCredential()
    );
  }
  return service.getContainerClient(config.AZURE_STORAGE_CONTAINER);
}

const missing = (err) => err?.statusCode === 404;

/**
 * @param {object} config  AZURE_STORAGE_* from config/env.js
 * @param {object} [containerClient]  a stand-in, for tests
 */
export function createAzureBlobStorage(config, containerClient) {
  let container = containerClient ? Promise.resolve(containerClient) : null;
  const getContainer = () => (container ??= createContainerClient(config));
  const blob = async (key) => {
    assertKey(key);
    return (await getContainer()).getBlockBlobClient(key);
  };

  return {
    async put(key, buffer) {
      await (await blob(key)).uploadData(buffer);
    },
    async get(key) {
      try {
        return await (await blob(key)).downloadToBuffer();
      } catch (err) {
        if (missing(err)) return null;
        throw err;
      }
    },
    async remove(key) {
      await (await blob(key)).deleteIfExists();
    },
    /** The blob's index tags; {} when the blob is gone. */
    async tags(key) {
      try {
        return (await (await blob(key)).getTags()).tags ?? {};
      } catch (err) {
        if (missing(err)) return {};
        throw err;
      }
    },
    /** For /api/ready: throws unless the container can be reached. */
    async check() {
      if (!(await (await getContainer()).exists())) {
        throw new Error('The storage container does not exist.');
      }
    },
  };
}
