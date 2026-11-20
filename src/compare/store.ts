// Keeps the study data (model runs and hand marks) in this browser's IndexedDB, so nothing is lost
// on a refresh or between days. It stays on this computer and browser only: download a backup now and then.

import type { Dataset } from './data'

const DB = 'formcheck-study'
const STORE = 'data'
const KEY = 'dataset'

function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB, 1)
        req.onupgradeneeded = () => req.result.createObjectStore(STORE)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
    })
}

export async function loadSaved(): Promise<Dataset | null> {
    try {
        const db = await open()
        return await new Promise((resolve) => {
            const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY)
            req.onsuccess = () => resolve((req.result as Dataset | undefined) ?? null)
            req.onerror = () => resolve(null)
        })
    } catch {
        return null
    }
}

export async function save(data: Dataset): Promise<boolean> {
    try {
        const db = await open()
        return await new Promise((resolve) => {
            const tx = db.transaction(STORE, 'readwrite')
            tx.objectStore(STORE).put(data, KEY)
            tx.oncomplete = () => resolve(true)
            tx.onerror = () => resolve(false)
        })
    } catch {
        return false
    }
}
