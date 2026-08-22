// IndexedDB and Profile persistence helper for 3D models in Hand Control Mode

const DB_NAME = 'orion_3d_models_db';
const STORE_NAME = 'custom_models';
const DB_VERSION = 1;
const CUSTOM_MODEL_KEY = 'last_custom_model';

export interface SavedCustomModel {
  name: string;
  data: ArrayBuffer;
  timestamp: number;
}

export interface PresetModel {
  id: string;
  name: string;
  url: string;
  description: string;
}

export const PRESET_MODELS: Record<string, PresetModel> = {
  robot: {
    id: 'robot',
    name: 'Expressive Robot',
    url: '/models/robot.glb',
    description: 'Articulated robotic scout chassis'
  },
  engine: {
    id: 'engine',
    name: 'Ion Drive Engine',
    url: '/models/engine.glb',
    description: 'Propulsion thruster component'
  },
  flamingo: {
    id: 'flamingo',
    name: 'Flamingo',
    url: '/models/flamingo.glb',
    description: 'Low-poly avian biological mesh'
  }
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB is not supported in this browser'));
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error || new Error('Failed to open IndexedDB'));
    };
  });
}

/**
 * Save custom uploaded GLB file to IndexedDB for local device persistence
 */
export async function saveCustomModelToIndexedDB(file: File): Promise<void> {
  const buffer = await file.arrayBuffer();
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const record: SavedCustomModel = {
      name: file.name,
      data: buffer,
      timestamp: Date.now()
    };

    const req = store.put(record, CUSTOM_MODEL_KEY);

    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error || new Error('Failed to save model to IndexedDB'));
  });
}

/**
 * Retrieve saved custom GLB file from IndexedDB and return an object URL
 */
export async function getCustomModelFromIndexedDB(): Promise<{ name: string; url: string } | null> {
  try {
    const db = await openDatabase();

    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(CUSTOM_MODEL_KEY);

      req.onsuccess = () => {
        const record = req.result as SavedCustomModel | undefined;
        if (!record || !record.data) {
          resolve(null);
          return;
        }

        const blob = new Blob([record.data], { type: 'model/gltf-binary' });
        const url = URL.createObjectURL(blob);
        resolve({
          name: record.name,
          url
        });
      };

      req.onerror = () => {
        resolve(null);
      };
    });
  } catch (err) {
    console.warn('[ModelStorage] IndexedDB not accessible:', err);
    return null;
  }
}

/**
 * Clear custom model from IndexedDB
 */
export async function clearCustomModelFromIndexedDB(): Promise<void> {
  try {
    const db = await openDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(CUSTOM_MODEL_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve(); // graceful fallback
    });
  } catch (err) {
    console.warn('[ModelStorage] Failed to clear IndexedDB:', err);
  }
}

/**
 * Save user preference for active 3D model
 */
export async function saveActiveModelPreference(
  modelInfo: { type: 'preset'; presetId: string } | { type: 'custom'; name: string } | null,
  authToken?: string | null
): Promise<void> {
  try {
    if (!modelInfo) {
      localStorage.removeItem('orion_last_model_pref');
      if (authToken) {
        await fetch('/api/profile', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`
          },
          body: JSON.stringify({
            category: 'preferences',
            key: 'hand_control_last_model',
            value: ''
          })
        }).catch(() => {});
      }
      return;
    }

    localStorage.setItem('orion_last_model_pref', JSON.stringify(modelInfo));

    if (authToken) {
      await fetch('/api/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          category: 'preferences',
          key: 'hand_control_last_model',
          value: JSON.stringify(modelInfo)
        })
      }).catch(() => {});
    }
  } catch (err) {
    console.warn('[ModelStorage] Error saving model preference:', err);
  }
}

/**
 * Load user preference for active 3D model from API or LocalStorage
 */
export async function getActiveModelPreference(
  authToken?: string | null
): Promise<{ type: 'preset'; presetId: string } | { type: 'custom'; name: string } | null> {
  try {
    if (authToken) {
      const res = await fetch('/api/profile', {
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      }).catch(() => null);

      if (res && res.ok) {
        const facts = await res.json();
        const prefFact = Array.isArray(facts)
          ? facts.find((f: any) => f.key === 'hand_control_last_model')
          : null;

        if (prefFact && prefFact.value) {
          try {
            const parsed = JSON.parse(prefFact.value);
            return parsed;
          } catch (e) {}
        }
      }
    }

    // Fallback to localStorage
    const local = localStorage.getItem('orion_last_model_pref');
    if (local) {
      return JSON.parse(local);
    }
  } catch (err) {
    console.warn('[ModelStorage] Error reading model preference:', err);
  }

  return null;
}
