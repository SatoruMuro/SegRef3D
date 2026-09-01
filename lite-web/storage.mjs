const DATABASE_NAME = "segref3d-lite-web";
const DATABASE_VERSION = 1;
const MASK_STORE = "masks";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(MASK_STORE)) {
        database.createObjectStore(MASK_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function createMaskStorageRecord(
  projectId,
  imageName,
  width,
  height,
  mask,
  { zIndex = null, sliceOrder = null } = {},
) {
  return {
    key: `${projectId}:${imageName}`,
    projectId,
    imageName,
    width,
    height,
    mask: mask.slice().buffer,
    zIndex: Number.isInteger(zIndex) ? zIndex : null,
    sliceOrder: typeof sliceOrder === "string" ? sliceOrder : null,
    updatedAt: Date.now(),
  };
}

export async function saveMask(projectId, imageName, width, height, mask, metadata = {}) {
  const database = await openDatabase();
  const record = createMaskStorageRecord(projectId, imageName, width, height, mask, metadata);
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(MASK_STORE, "readwrite");
    transaction.objectStore(MASK_STORE).put(record);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function loadMask(projectId, imageName, width, height, metadata = {}) {
  const database = await openDatabase();
  const key = `${projectId}:${imageName}`;
  const record = await new Promise((resolve, reject) => {
    const request = database
      .transaction(MASK_STORE, "readonly")
      .objectStore(MASK_STORE)
      .get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
  database.close();
  if (!record || record.width !== width || record.height !== height) return null;
  if (
    record.sliceOrder && metadata.sliceOrder && record.sliceOrder !== metadata.sliceOrder
  ) return null;
  if (
    Number.isInteger(record.zIndex) && Number.isInteger(metadata.zIndex) &&
    record.zIndex !== metadata.zIndex
  ) return null;
  const restored = new Uint8Array(record.mask);
  return restored.length === width * height ? restored : null;
}

export async function clearProjectMasks(projectId) {
  const database = await openDatabase();
  const records = await new Promise((resolve, reject) => {
    const request = database
      .transaction(MASK_STORE, "readonly")
      .objectStore(MASK_STORE)
      .getAll();
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(MASK_STORE, "readwrite");
    const store = transaction.objectStore(MASK_STORE);
    for (const record of records) {
      if (record.projectId === projectId) store.delete(record.key);
    }
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}
