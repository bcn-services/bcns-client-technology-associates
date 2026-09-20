// Storage seam for the download-route test: `state.adapter = null` reproduces an
// unconfigured backend, which must read as a configuration fault, not a missing file.
class StorageObjectNotFoundError extends Error { constructor(key) { super(`storage object not found: ${key}`); this.name = "StorageObjectNotFoundError"; } }
class StorageOperationError extends Error { constructor(key, cause) { super(`storage operation failed for ${key}: ${cause}`); this.name = "StorageOperationError"; } }
const state = { adapter: null };
module.exports = { state, STORAGE_BUCKET: "case-documents", StorageObjectNotFoundError, StorageOperationError, getStorageAdapter: () => state.adapter };
