import { createHmac } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const API_VERSION = "2022-11-02";

/** Local adapter used by self-hosted installs and tests. */
export class LocalBlobStore {
  constructor(root) {
    this.root = root;
  }

  async put(key, value) {
    const file = this.path(key);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, value);
  }

  async get(key) {
    try {
      return await readFile(this.path(key));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async signedUrl() {
    return null;
  }

  path(key) {
    const safe = String(key).replace(/^\/+/, "").replace(/\.\./g, "");
    return join(this.root, safe);
  }
}

/**
 * Private Azure Blob container. Writes use SharedKey; reads can go through the
 * API or through the short-lived service SAS returned by signedUrl().
 */
export class AzureBlobStore {
  constructor({
    accountName,
    accountKey,
    container,
    blobEndpoint,
    fetchImpl = fetch,
  }) {
    this.accountName = accountName;
    this.accountKey = Buffer.from(accountKey, "base64");
    this.container = container;
    this.blobEndpoint = (
      blobEndpoint || `https://${accountName}.blob.core.windows.net`
    ).replace(/\/$/, "");
    this.fetchImpl = fetchImpl;
  }

  async put(key, value, contentType = "application/octet-stream") {
    const body = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
    const date = new Date().toUTCString();
    const headers = {
      "x-ms-date": date,
      "x-ms-version": API_VERSION,
      "x-ms-blob-type": "BlockBlob",
      "content-type": contentType,
      "content-length": String(body.length),
      authorization: this.authorization(
        "PUT",
        key,
        body.length,
        contentType,
        date,
      ),
    };

    const response = await this.fetchImpl(this.url(key), {
      method: "PUT",
      headers,
      body,
    });
    if (!response.ok) {
      throw new Error(`Blob upload failed with ${response.status}.`);
    }
  }

  async get(key) {
    const response = await this.fetchImpl(this.url(key), {
      headers: { "x-ms-version": API_VERSION },
    });
    if (response.status === 404) return null;
    if (!response.ok)
      throw new Error(`Blob read failed with ${response.status}.`);
    return Buffer.from(await response.arrayBuffer());
  }

  signedUrl(key, ttlSeconds = 300) {
    const expires = new Date(Date.now() + ttlSeconds * 1000)
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z");
    const permissions = "r";
    const resource = "b";
    const canonical = `/blob/${this.accountName}/${this.container}/${key}`;
    const stringToSign = [
      permissions,
      "",
      expires,
      canonical,
      "",
      "",
      "",
      API_VERSION,
      resource,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ].join("\n");
    const signature = createHmac("sha256", this.accountKey)
      .update(stringToSign)
      .digest("base64");

    const url = new URL(this.url(key));
    url.searchParams.set("sv", API_VERSION);
    url.searchParams.set("st", "");
    url.searchParams.set("se", expires);
    url.searchParams.set("sr", resource);
    url.searchParams.set("sp", permissions);
    url.searchParams.set("sig", signature);
    return url.toString();
  }

  url(key) {
    return `${this.blobEndpoint}/${this.container}/${key}`;
  }

  authorization(method, key, length, contentType, date) {
    const canonicalHeaders = [
      "x-ms-blob-type:BlockBlob",
      `x-ms-date:${date}`,
      `x-ms-version:${API_VERSION}`,
    ].join("\n");
    const stringToSign = [
      method,
      "",
      "",
      String(length),
      "",
      contentType,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      `${canonicalHeaders}\n/blob/${this.accountName}/${this.container}/${key}`,
    ].join("\n");
    const signature = createHmac("sha256", this.accountKey)
      .update(stringToSign)
      .digest("base64");
    return `SharedKey ${this.accountName}:${signature}`;
  }
}

export function createBlobStore({
  connectionString,
  container = "comply",
  dataDir,
  fetchImpl = fetch,
} = {}) {
  if (connectionString) {
    const parts = Object.fromEntries(
      String(connectionString)
        .split(";")
        .filter(Boolean)
        .map((item) => {
          const index = item.indexOf("=");
          return [item.slice(0, index), item.slice(index + 1)];
        }),
    );
    if (!parts.AccountName || !parts.AccountKey) {
      throw new Error(
        "The blob connection string needs AccountName and AccountKey.",
      );
    }
    return new AzureBlobStore({
      accountName: parts.AccountName,
      accountKey: parts.AccountKey,
      blobEndpoint: parts.BlobEndpoint,
      container,
      fetchImpl,
    });
  }

  if (!dataDir)
    throw new Error("A data directory is required for local blobs.");
  return new LocalBlobStore(join(dataDir, "blobs"));
}
